# Making product search fast at 7M rows

A worked example: the product search box went from **40 seconds** to **300
milliseconds**. This is what was wrong, why, and how each fix works.

Every number here was measured against a real 7,000,001-row table (1.4 GB of
heap) with `EXPLAIN (ANALYZE, BUFFERS)`, not estimated.

---

## The symptom, and why it was confusing

Searching a full SKU took ~40s. But searching a common word like "walnut" was
instant. That is backwards from what you would expect — **the more specific the
search, the slower it got.**

Reading the browser waterfall made it look like a network problem:

```text
Waiting for server response ....    24.16 ms
Content Download ................   40.19 s
```

That is misleading. This is a React Server Component response, so the server
sends headers immediately and then _streams_ the body. The `await` on the
database happens while the body streams, so slow queries show up in **Content
Download**, not in TTFB. If you see a fast TTFB and a huge download for a small
page, the server is still working — look at the database, not the network.

---

## The root cause: one character

The search predicate looked like this:

```ts
ilike(products.sku, `%${term}%`);
```

That leading `%` is the entire problem.

A B-tree index is a sorted structure. It can answer `LIKE 'SEED-067%'` because
it can seek to where `SEED-067` starts and read forward. It cannot answer
`LIKE '%SEED-067%'`, because a match could be anywhere inside the string and
there is nothing to seek to. **No B-tree index in the schema could ever serve
this query.** Postgres had no option but to read all 7M rows.

That single fact produced two separate performance bugs.

---

## Bug 1: the count scanned the whole table, every keystroke

The list query ran two statements in parallel — one page of rows, and an
unpaged total for the pager:

```ts
const [rows, [totals]] = await Promise.all([
  db.select().from(products).where(where).limit(20),
  db.select({ value: count() }).from(products).where(where), // ← 3.5 seconds
]);
```

Running them in parallel is good design: latency is the slower of the two, not
the sum. But `count(*)` has to visit **every** matching row to produce an exact
number. `LIMIT` cannot help it — you cannot count to a total by stopping early.

```text
Parallel Seq Scan on products  (actual time=4.719..3428.242 rows=194800 loops=3)
  Rows Removed by Filter: 2138533
Execution Time: 3472.460 ms
```

3.5 seconds, on every keystroke, for a number nobody reads past the first two
digits.

---

## Bug 2: the abort-early trap (the interesting one)

This is the 40-second bug, and it is worth understanding because it will bite
you again in other queries.

The rows query was `ORDER BY created_at DESC LIMIT 20`. There _is_ an index on
`created_at`, so the planner made a reasonable-sounding bet:

> "I'll walk `products_created_at_idx` backwards, checking each row against the
> filter, and stop as soon as I have 20 matches. I'll probably hit 20 quickly."

When matches are dense, that bet is brilliant — 20 matches arrive in the first
few hundred rows, and the query takes 4 ms. It beats any index.

When matches are sparse, the bet is catastrophic. Searching one specific SKU
means walking the entire table in **index order**, which is random access
against the heap, and never finding the 20th match because only one exists:

```text
Index Scan Backward using products_created_at_idx  (actual time=..41646.752)
  Filter: (sku ~~* '%SEED-04212345%' OR name ~~* ...)
  Rows Removed by Filter: 7000001          ← every row in the table
  Buffers: shared hit=637001 read=6407969  ← 6.4M random page reads
Execution Time: 40025.312 ms
```

**The lesson:** a plan that stops early is only fast if it actually stops early.
The planner cannot know how selective `%term%` is, so it guesses — and when it
guesses wrong the failure mode is not "a bit slower", it is a full table scan in
the worst possible access pattern. This is called an _abort-early plan_, and the
tell is `LIMIT` + `ORDER BY` on an indexed column + a filter the planner cannot
estimate.

---

## Fix 1: trigram indexes make `%term%` indexable

`pg_trgm` breaks text into three-character chunks and indexes those. `"walnut"`
becomes `wal`, `aln`, `lnu`, `nut`. To find rows matching `%walnut%`, Postgres
looks up rows containing all those trigrams — and _that_ is an index lookup.

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX products_sku_trgm_idx  ON products USING gin (sku  gin_trgm_ops);
CREATE INDEX products_name_trgm_idx ON products USING gin (name gin_trgm_ops);
```

Declared in [`src/db/schema/products.ts`](../src/db/schema/products.ts), applied
by [`drizzle/0002_*.sql`](../drizzle/0002_abandoned_lady_deathstrike.sql).

Two things to know:

- **drizzle-kit will not emit `CREATE EXTENSION`.** It generates the indexes and
  nothing else, and the migration then fails with `operator class
"gin_trgm_ops" does not exist`. Add the extension line to the migration by hand.
- **Index builds lock writes.** Measured at 7M rows: 42 s for `name`, 19 s for
  `sku`. Reads are unaffected. To avoid the write pause in production, run
  `CREATE INDEX CONCURRENTLY` by hand _outside_ a migration — Drizzle wraps
  migrations in a transaction, and `CONCURRENTLY` cannot run inside one.

### The trap: this alone fixed nothing

Adding the index and re-running the search still took **42 seconds**. The
planner kept choosing its abort-early plan and ignored the new index entirely.

This is the most important thing in this document. _Having_ an index and
_using_ an index are different problems. Always re-run `EXPLAIN ANALYZE` after
adding an index — if the plan did not change, you have paid for an index and
bought nothing.

---

## Fix 2: forcing the index with `AS MATERIALIZED`

To make Postgres use the trigram index, the query has to be shaped so the
abort-early plan is not available:

```sql
WITH matches AS MATERIALIZED (
  SELECT id FROM products WHERE (sku ILIKE $1 OR name ILIKE $1)
)
SELECT p.* FROM products p JOIN matches m ON m.id = p.id
ORDER BY p.created_at DESC, p.id ASC LIMIT 20 OFFSET 0;
```

`AS MATERIALIZED` is an **optimisation fence**. It forces Postgres to fully
resolve the CTE before the outer query runs. So it must answer "which rows
match?" first — via a bitmap scan over the trigram indexes — and only then sort
the survivors. There is no opportunity to walk the timestamp index hopefully.

Result on the same query: **42,383 ms → 0.7 ms.**

Two ways to get this wrong:

- **Putting `LIMIT` inside the CTE** re-enables the abort-early plan inside the
  fence. Measured: straight back to 41 seconds.
- **Omitting `MATERIALIZED`** lets Postgres inline the CTE and plan it as one
  query again. Since PG12, plain CTEs are inlined by default.

Drizzle has no syntax for `MATERIALIZED`, so this one query is raw SQL in
[`products.repository.ts`](../src/modules/products/products.repository.ts). The
`WHERE` clause is still a Drizzle `SQL` object, so the search term stays a bound
parameter — no string interpolation, no injection.

---

## Fix 3: stop counting at a cap

An exact total over millions of rows is expensive and nobody reads it. Count to
a limit instead, and render `5,000+` past it:

```sql
SELECT count(*) FROM (SELECT 1 FROM products WHERE ... LIMIT 5000) t;
```

The `LIMIT` is _inside_ the subquery, so Postgres stops feeding the aggregate
once it has enough rows. **3,636 ms → 91 ms**, and the cost is now bounded
rather than proportional to the catalogue.

The cost scales with the cap, so it is a dial you can turn:

| Cap    | Time   |
| ------ | ------ |
| 1,000  | 29 ms  |
| 5,000  | 91 ms  |
| 10,000 | 178 ms |

The UI has to be honest about this. [`data-table.tsx`](../src/components/shared/data-table.tsx)
takes a `totalRowsCapped` flag: it renders `5,000+`, shows `…` instead of a page
count, and keeps **Next** enabled while a full page comes back — because the
real page count is unknown and `Math.ceil` would invent one.

---

## Fix 4: pick the plan based on how many rows match

Here is the catch: **neither row query is fast in both regimes.** Measured on
the same table:

| Matches | Original plan (walk `created_at`) | Trigram + `MATERIALIZED` |
| ------- | --------------------------------- | ------------------------ |
| 0       | 42,383 ms                         | **0.7 ms**               |
| 100     | 8,504 ms                          | **167 ms**               |
| 1,000   | 1,028 ms                          | **167 ms**               |
| 10,000  | **93 ms**                         | 313 ms                   |
| 580,000 | **4 ms**                          | 9,012 ms                 |

They cross at a few thousand matches. Below that, the trigram plan wins by
orders of magnitude. Above it, the original plan wins — dense matches mean the
abort-early bet pays off, and the trigram plan is stuck sorting half a million
rows.

So the code runs the capped count **first** and uses it as a probe:

```ts
const total = await countUpToCap(where); // ~10-175ms, and it is the pager total
const totalCapped = total >= MATCH_CAP;

return {
  rows: totalCapped
    ? await selectPage(input, where) // dense → original plan
    : await selectPageByMatches(input, where), // sparse → trigram plan
  total,
  totalCapped,
};
```

The count is doing double duty — it is the number the pager displays _and_ the
selectivity estimate the planner could not make. That is why it runs before the
rows instead of alongside them: the extra round trip costs ~10–175 ms and saves
up to 40 seconds.

---

## Fix 5: stop searching `description`

The predicate searched `sku`, `name`, **and** `description` — while the toolbar
had always said _"Search by SKU or name…"_. Dropping `description`:

- removed a **504 MB** trigram index (vs 288 MB for `name`, 134 MB for `sku`),
- removed the worst source of low-selectivity matches — a word common in product
  copy matched ~1M of 7M rows,
- made the code match what the UI promised.

The cheapest optimisation is usually the work you decide not to do.

---

## The bug this introduced (worth learning from)

After shipping the above, `?search=SEED-06781` crashed while `?search=walnut`
worked fine.

`db.execute()` returns **raw driver rows** and bypasses Drizzle's result mapper.
Drizzle installs its own Postgres type parsers and builds `Date` objects in that
mapper — so `created_at` arrived as the string `'2026-08-04 23:59:36.313+00'`,
and `page.tsx` called `.toISOString()` on a string.

It looked term-specific because only _sparse_ searches take the raw-SQL path.
Dense searches and empty searches still used Drizzle's own query builder, which
maps types correctly.

The fix is to restore the shape `db.select()` would have returned:

```ts
createdAt: new Date(row.created_at),
```

**Two lessons.** First, if you drop to raw SQL inside an ORM, you own the type
mapping. Second — and this is the one that cost time — the verification that
missed this compared row **ids** between the old and new query. Ids matched
perfectly. A type error is invisible to an id comparison. The check that catches
it is `assert.deepStrictEqual` on the full row objects, plus an explicit
`instanceof Date`. **Verify the property you actually care about, not the
easiest property to compare.**

---

## Results

Measured end to end through the repository:

| Case                        | Before        | After      |
| --------------------------- | ------------- | ---------- |
| **Full SKU**                | **40,025 ms** | **302 ms** |
| No matches                  | 37,255 ms     | 3 ms       |
| ~100 matches                | 8,504 ms      | 245 ms     |
| ~10,000 matches             | —             | 253 ms     |
| Common word (~580k matches) | ~3,500 ms     | 56 ms      |
| 2-character term            | —             | 31 ms      |
| No search term              | ~600 ms       | 604 ms     |

Cost: +422 MB of index (two trigram indexes), −504 MB (dropped description
index).

---

## How to diagnose this yourself

```bash
psql "$DATABASE_URL"
```

```sql
-- Always ANALYZE, never just EXPLAIN. Estimates lie; this runs the query.
-- BUFFERS shows how many pages it actually touched.
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM products WHERE name ILIKE '%widget%'
ORDER BY created_at DESC LIMIT 20;
```

What to look for:

| Signal in the plan                          | What it means                                   |
| ------------------------------------------- | ----------------------------------------------- |
| `Rows Removed by Filter:` ≈ your table size | Full scan. The filter is not indexed.           |
| `Seq Scan` on a large table                 | No usable index, or the planner rejected it.    |
| Large `read=` vs `hit=` in `Buffers`        | Cache misses — real disk I/O.                   |
| `Index Scan Backward` + `LIMIT` + a filter  | Abort-early plan. Test it with a _rare_ value.  |
| Plan unchanged after adding an index        | The index is not being used. Reshape the query. |

**Test with a rare value, not a common one.** A common search term hides
abort-early bugs completely — that is exactly how this one survived to
production.

---

## Known limits and what is left

- **Terms under 3 characters cannot use a trigram index.** There are no
  trigrams to look up, so Postgres falls back to a scan. It is bounded by the
  capped count (measured 31 ms) because short terms match densely, but a rare
  two-character term will be slow. Enforce a 3-character minimum in
  `listProductsSchema` if it ever matters.

- **The unfiltered page load (~604 ms) is now the slowest path**, dominated by
  the exact `count(*)` over all 7M rows. Fixable with an estimate from
  `pg_class.reltuples`, at the cost of showing "~7,000,000" instead of a precise
  number.

- **Sorting by a non-indexed column is slow** — `ORDER BY name` with no search
  term takes ~1,150 ms, because there is no index on `name` to provide order.
  Add a B-tree index on the columns people actually sort by.

- **`shared_buffers` is 128 MB** against a 2.8 GB table, which is why the plans
  above show far more `read=` than `hit=`. Raising it in
  [`docker-compose.yml`](../docker-compose.yml) helps every query here.

- **Deep pagination degrades**: `OFFSET 200000` costs ~800 ms because Postgres
  generates and discards every skipped row. Keyset pagination ("where
  `created_at` < last seen") fixes it, at the cost of losing jump-to-page.

### When to stop using Postgres for this

Everything above keeps search in Postgres, which is the right call at this size.
If you need typo tolerance, relevance ranking, faceting, or multi-word queries
that match across fields, that is a search engine's job — Meilisearch,
Typesense, or Elasticsearch — with Postgres remaining the source of truth. The
signal to switch is not row count, it is when you start wanting _search
features_ rather than _fast filters_.
