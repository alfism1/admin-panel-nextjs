import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/db/client";
import { newId } from "@/db/id";
import { products, type ProductRow } from "@/db/schema";

import type { ListProductsInput } from "./products.schema";

/**
 * Product data access.
 *
 * Drizzle only: no authorization, no auditing, no zod. Everything here assumes
 * its input was already validated by the service, which is what makes these
 * functions safe to call from a seed script or a migration with no request
 * context around them.
 */

/** One page of results, as `list` returns it. */
interface ProductPage {
  rows: ProductRow[];
  /**
   * Rows matching the filter. A floor, not the count, when `totalCapped` — the
   * pager has to say "5,000+" rather than claim a total it did not measure.
   */
  total: number;
  totalCapped: boolean;
}

/** The writable columns. Not `ProductRow` — `id` and the timestamps are ours. */
interface ProductValues {
  sku: string;
  name: string;
  description: string | null;
  priceCents: number;
  archived: boolean;
}

/**
 * Sortable columns, keyed by the values `listProductsSchema.sort` allows.
 * This lookup is what stops `?sort=<anything>` from reaching SQL.
 */
const SORT_COLUMNS = {
  name: products.name,
  sku: products.sku,
  priceCents: products.priceCents,
  createdAt: products.createdAt,
} as const;

/** The same columns, spelled for the raw query in `selectPageByMatches`. */
const SORT_SQL_COLUMNS: Record<ListProductsInput["sort"], string> = {
  name: "name",
  sku: "sku",
  priceCents: "price_cents",
  createdAt: "created_at",
};

/**
 * How far `list` counts before it stops and reports a floor.
 *
 * An unpaged `count(*)` has to visit every matching row. At 7M products a broad
 * term costs seconds — on every keystroke — to produce a number nobody reads
 * past the first two digits. Counting to a cap and rendering "5,000+" past it
 * makes the cost bounded instead of proportional (measured: 3.6s → 29ms).
 *
 * Raising it is safe, and roughly linear in cost.
 */
const MATCH_CAP = 5_000;

/** `\`, `%` and `_` are LIKE metacharacters: searching "100%" must not scan the table. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function buildWhere(input: ListProductsInput): SQL | undefined {
  const clauses: SQL[] = [];

  const term = input.search.trim();
  if (term) {
    const pattern = likePattern(term);
    // `description` is deliberately not searched. The toolbar has always
    // promised "SKU or name"; including description contradicted that, and it
    // was where the expensive matches came from — a word common to product copy
    // matched ~1M of 7M rows, and its trigram index alone cost ~500MB.
    const searchClause = or(
      ilike(products.sku, pattern),
      ilike(products.name, pattern),
    );
    if (searchClause) clauses.push(searchClause);
  }

  if (input.status === "archived") {
    clauses.push(eq(products.archived, true));
  } else if (input.status === "active") {
    clauses.push(eq(products.archived, false));
  }

  // `and()` of nothing is not the same as no WHERE at all — return undefined so
  // Drizzle omits the clause entirely.
  if (clauses.length === 0) return undefined;
  return and(...clauses);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * One page of products, plus the total across all pages.
 *
 * There is no single query plan that is fast for every search, so this picks
 * one. The two candidates are `selectPage` and `selectPageByMatches`, and which
 * of them wins depends entirely on how many rows the term matches:
 *
 *   matches │ selectPage │ selectPageByMatches
 *   ────────┼────────────┼────────────────────
 *         0 │  40,000ms  │       0.7ms
 *       100 │   8,500ms  │       167ms
 *     1,000 │   1,000ms  │       167ms
 *    10,000 │      93ms  │       313ms
 *   580,000 │       4ms  │     9,000ms
 *
 * They cross at a few thousand, which is what `MATCH_CAP` is set near — so the
 * capped count is both the number the pager displays and the probe that picks
 * the plan. That is why it runs first rather than alongside: the extra round
 * trip costs ~10-175ms and saves up to 40 seconds.
 */
async function list(input: ListProductsInput): Promise<ProductPage> {
  const where = buildWhere(input);

  // No search term, so there is no selectivity question to answer: the sort is
  // index-ordered, and the exact total is one scan the planner parallelises.
  if (!input.search.trim()) {
    const [rows, [totals]] = await Promise.all([
      selectPage(input, where),
      db.select({ value: count() }).from(products).where(where),
    ]);
    return { rows, total: totals?.value ?? 0, totalCapped: false };
  }

  const total = await countUpToCap(where);
  const totalCapped = total >= MATCH_CAP;

  return {
    rows: totalCapped
      ? await selectPage(input, where)
      : await selectPageByMatches(input, where),
    total,
    totalCapped,
  };
}

/**
 * The paged read in the shape the planner reaches for on its own.
 *
 * `ORDER BY created_at DESC LIMIT 20` lets it walk `products_created_at_idx`
 * backwards and stop at the 20th row that survives the filter. When matches are
 * dense that is unbeatable, because it stops almost immediately.
 *
 * When matches are sparse it is the 40-second case: nothing tells the planner
 * the filter is selective, so it keeps walking, and a search matching one row
 * reads all 7M. Only call this when the count says matches are dense.
 */
function selectPage(
  input: ListProductsInput,
  where: SQL | undefined,
): Promise<ProductRow[]> {
  const column = SORT_COLUMNS[input.sort];
  const orderBy = input.order === "asc" ? asc(column) : desc(column);

  return (
    db
      .select()
      .from(products)
      .where(where)
      // `id` breaks ties, so a row can't show up on two pages when the sort
      // column holds duplicates — two products created in the same second, or
      // sharing a name.
      .orderBy(orderBy, asc(products.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize)
  );
}

/**
 * The paged read with the trigram indexes forced.
 *
 * `AS MATERIALIZED` is the entire trick. It is an optimisation fence, so
 * Postgres has to resolve the filter into a row set *before* it considers the
 * ORDER BY — and resolving it means a bitmap scan over the trigram indexes.
 * The sort then runs over whatever few rows survived instead of over the table.
 *
 * The fence is also why LIMIT sits outside the CTE. Moving it inside restores
 * the planner's freedom to walk the timestamp index again, and with it the 40
 * seconds; that is a real thing to get wrong, not a hypothetical.
 *
 * Raw SQL because Drizzle's `$with` cannot spell MATERIALIZED. `where` is still
 * a Drizzle `SQL` object, so the search term stays a bound parameter.
 */
async function selectPageByMatches(
  input: ListProductsInput,
  where: SQL | undefined,
): Promise<ProductRow[]> {
  const result = await db.execute<ProductDbRow>(sql`
    WITH matches AS MATERIALIZED (
      SELECT ${products.id} AS id
      FROM ${products}
      ${where ? sql`WHERE ${where}` : sql.empty()}
    )
    SELECT p.*
    FROM ${products} AS p
    JOIN matches AS m ON m.id = p.id
    ORDER BY ${orderByFragment(input)}
    LIMIT ${input.pageSize}
    OFFSET ${(input.page - 1) * input.pageSize}
  `);

  return result.rows.map(toProductRow);
}

/**
 * `count(*)` that stops at `MATCH_CAP`.
 *
 * The LIMIT is inside the subquery, so Postgres stops feeding the aggregate
 * once it has enough rows rather than resolving every match first.
 */
async function countUpToCap(where: SQL | undefined): Promise<number> {
  const capped = db
    .select({ one: sql<number>`1` })
    .from(products)
    .where(where)
    .limit(MATCH_CAP)
    .as("capped");

  const [row] = await db.select({ value: count() }).from(capped);
  return row?.value ?? 0;
}

/**
 * `ORDER BY` for the raw query, aliased to `p`.
 *
 * `sql.raw` is safe here only because both halves come from fixed maps keyed by
 * the zod enums in `listProductsSchema` — no caller-supplied string reaches it.
 * Keep it that way.
 */
function orderByFragment(input: ListProductsInput): SQL {
  const column = SORT_SQL_COLUMNS[input.sort];
  const direction = input.order === "asc" ? "ASC" : "DESC";
  return sql.raw(`p."${column}" ${direction}, p."id" ASC`);
}

/**
 * `db.execute` hands back driver rows, so these are column names, not fields.
 *
 * The timestamps are the trap. Drizzle installs its own pg type parsers and
 * does date construction in its result mapper, which `db.execute` bypasses —
 * so `created_at` arrives as the raw string Postgres sent, not a `Date`.
 * Typed as both because that is a driver-level detail this file should survive
 * a change in, and `new Date()` is a no-op cost on an already-parsed value.
 */
interface ProductDbRow extends Record<string, unknown> {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  price_cents: number;
  archived: boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

/** Restores the shape `db.select()` would have returned, `Date`s included. */
function toProductRow(row: ProductDbRow): ProductRow {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    archived: row.archived,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

async function findById(id: string): Promise<ProductRow | null> {
  const [row] = await db
    .select()
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  return row ?? null;
}

async function findBySku(sku: string): Promise<ProductRow | null> {
  const [row] = await db
    .select()
    .from(products)
    .where(eq(products.sku, sku))
    .limit(1);
  return row ?? null;
}

/**
 * Uniqueness pre-check, so the service can raise a readable `ConflictError`
 * instead of surfacing a driver constraint violation.
 *
 * `exceptId` excludes the row being edited, so saving a product without
 * touching its SKU doesn't collide with itself. This is the friendly path, not
 * the guarantee — `products_sku_unique` is, and it still wins under a race.
 */
async function isSkuTaken(sku: string, exceptId?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: products.id })
    .from(products)
    .where(
      exceptId
        ? and(eq(products.sku, sku), ne(products.id, exceptId))
        : eq(products.sku, sku),
    )
    .limit(1);
  return Boolean(row);
}

async function stats(): Promise<{ total: number; archived: number }> {
  const [[total], [archived]] = await Promise.all([
    db.select({ value: count() }).from(products),
    db
      .select({ value: count() })
      .from(products)
      .where(eq(products.archived, true)),
  ]);
  return { total: total?.value ?? 0, archived: archived?.value ?? 0 };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** The id is generated here so the service can audit the row it just wrote. */
async function insert(values: ProductValues): Promise<ProductRow> {
  const [row] = await db
    .insert(products)
    .values({ id: newId(), ...values })
    .returning();
  // A successful insert always returns a row; this narrows the type and turns a
  // driver-level surprise into a readable error instead of an undefined deref.
  if (!row) throw new Error("Insert into products returned no row.");
  return row;
}

/** `null` means no row matched — the service turns that into `NotFoundError`. */
async function update(
  id: string,
  values: Partial<ProductValues>,
): Promise<ProductRow | null> {
  const [row] = await db
    .update(products)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  return row ?? null;
}

async function remove(id: string): Promise<void> {
  await db.delete(products).where(eq(products.id, id));
}

export const productsRepository = {
  list,
  findById,
  findBySku,
  isSkuTaken,
  stats,
  insert,
  update,
  remove,
};

export type { ProductPage, ProductValues };
