# Adding a new module

A worked example: adding a **product** module end to end.

The condensed version lives in [the README](../README.md#how-to-add-a-new-module).
This is the long form — every file, in dependency order, with the reasoning
behind each convention.

---

## Naming convention first (this trips people up)

The codebase is not uniform by accident — each name has a different job:

| Thing                   | Value                       | Why                                                                                  |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| DB table                | `products`                  | plural, snake_case                                                                   |
| Schema file             | `src/db/schema/products.ts` | plural, matches table                                                                |
| Module folder           | `src/modules/products/`     | plural, like `users/`                                                                |
| Module file prefix      | `products.*.ts`             | matches folder (`feature-flags/` uses `feature-flag.*` — older style, don't copy it) |
| **Permission resource** | `product`                   | **singular** — `statement` keys are singular (`user`, `role`, `featureFlag`)         |
| Audit resource type     | `product`                   | singular, matches the permission resource                                            |
| Route                   | `/products`                 | plural                                                                               |

Rule of thumb: **plural for collections (table, folder, route), singular for the
authorization and audit vocabulary.**

## The steps at a glance

```text
Foundations (touch shared files)
  1. DB schema + migration
  2. Permission statement + role grants + seed
  3. Audit vocabulary
  4. Cache tags

The module itself (src/modules/products/)
  5. products.schema.ts      zod
  6. products.repository.ts  drizzle only
  7. products.service.ts     authorise → validate → mutate → audit → invalidate
  8. products.actions.ts     "use server" wrappers

UI
  9.   app/(dashboard)/products/page.tsx   RSC, permission gate, data fetch
  10.  components/products-view.tsx        "use client", DataTable
  10b. components/product-dialog.tsx      "use client", react-hook-form
  11.  nav-config.ts entry

Optional + verification
  12. app/api/products/route.ts           REST surface
  13. tests (unit / component / e2e) + typecheck + lint
```

Every step below carries the complete file, not a sketch — copy it, rename the
nouns, and it compiles. The code was typechecked against this repo's real
`drizzle-orm`, shared components and `lib/`, and the Step 13 service test was
run (10 passing) before being written down.

---

## Step 1 — Database schema

**File:** `src/db/schema/products.ts` _(new)_

```ts
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(), // no gen_random_uuid() — see below
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    priceCents: integer("price_cents").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("products_sku_unique").on(table.sku),
    index("products_archived_idx").on(table.archived),
    index("products_created_at_idx").on(table.createdAt),
  ],
);

export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;
```

Three conventions to follow exactly:

- **`id: text("id").primaryKey()` with no DB default.** IDs come from `newId()`
  in `src/db/id.ts`. The service needs the id _before_ the INSERT so an audit
  entry and the row it describes can be written together — and it keeps the
  schema dialect-portable.
- **`{ withTimezone: true, mode: "date" }` on every timestamp.** Consistent with
  every other table; `mode: "date"` hands you a JS `Date` rather than a string.
- **Index every column you'll sort or filter by.** `sort`/`order` arrive from the
  URL, so the sortable set is known up front.

**File:** `src/db/schema/index.ts` _(edit)_ — add one line:

```ts
export * from "./products";
```

That barrel is what `drizzle.config.ts` and `src/db/client.ts` both point at, so
this single line makes the table visible to migrations _and_ the query builder.

```bash
pnpm db:generate   # writes drizzle/000N_*.sql — read it before applying
pnpm db:migrate
```

---

## Step 2 — Permissions

**File:** `src/lib/permissions.ts` _(edit)_

Add the resource to `statement`:

```ts
export const statement = {
  user: [...],
  session: [...],
  role: [...],
  auditLog: ["read", "export"],
  featureFlag: [...],
  product: ["create", "read", "update", "delete", "archive"],  // ← new
} as const satisfies Record<string, readonly string[]>;
```

This one line gives you, for free:

- `requirePermission("product", "archive")` typechecks; `"archvie"` doesn't compile
- `PermissionKey` now includes `"product:read"`, so `nav-config.ts` accepts it
- The Roles permission matrix renders a Product section after seeding

Then grant it in `SYSTEM_ROLES` in the same file:

```ts
// super_admin
grants: { …, product: allActions("product") },

// admin
grants: { …, product: ["create", "read", "update", "delete", "archive"] },

// viewer
grants: { …, product: ["read"] },
```

```bash
pnpm db:seed   # syncPermissionCatalog() reconciles the DB against the statement
```

> **Think about `archive` vs `delete` separately.** `feature-flags` splits
> `toggle` out of `update` deliberately, so an on-call engineer can kill a flag
> without being able to edit rollout rules. Give a separate action to anything
> you'd want to delegate independently.

---

## Step 3 — Audit vocabulary

**File:** `src/modules/audit-log/audit-log.schema.ts` _(edit)_

```ts
export const AUDIT_ACTIONS = [
  // …
  "product.created",
  "product.updated",
  "product.deleted",
  "product.archived",
  "product.unarchived",
] as const;

export const AUDIT_RESOURCE_TYPES = [
  "user",
  "role",
  "featureFlag",
  "session",
  "auditLog",
  "system",
  "product", // ← new
] as const;
```

It's a **closed set on purpose**: the audit-log filter dropdown is generated from
it, so a typo like `"product.archvied"` would otherwise become a silent second
category nobody ever filters for. `logAudit()` won't compile with an action that
isn't listed here.

---

## Step 4 — Cache tags

**File:** `src/modules/cache/cache-keys.ts` _(edit)_

```ts
export const cacheTags = {
  // …
  products: "products",
  product: (id: string) => `product:${id}`,
} as const;
```

Every key and tag in the app is declared in this one file, so _"what does this
write invalidate?"_ is answerable by reading a single file. Only add a
`cacheKeys` entry if you're going to Redis-cache reads (see Step 7) — for a plain
CRUD list, tags alone are enough.

---

## Step 5 — `products.schema.ts` (zod, the input contract)

**File:** `src/modules/products/products.schema.ts` _(new)_

```ts
import { z } from "zod";

export const listProductsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["name", "sku", "priceCents", "createdAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().trim().max(200).default(""),
  status: z.enum(["active", "archived"]).optional(),
});
export type ListProductsInput = z.infer<typeof listProductsSchema>;

export const skuField = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, "Uppercase letters, digits and hyphens only.");

export const createProductSchema = z.object({
  sku: skuField,
  name: z.string().trim().min(1, "Name is required.").max(160),
  description: z.string().trim().max(2000).optional(),
  priceCents: z.number().int().min(0).max(100_000_000),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema
  .omit({ sku: true }) // SKU is immutable after creation
  .extend({ id: z.string().min(1) });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productIdSchema = z.object({ id: z.string().min(1) });
export const archiveProductSchema = z.object({
  id: z.string().min(1),
  archived: z.boolean(),
});
```

Two rules that matter here:

1. **`sort` is an enum, never a free string.** The repository maps it to a column
   through a lookup object — that's what stops `?sort=<anything>` from reaching
   SQL.
2. **No `z.coerce` in a schema a form uses.** `z.coerce.number()` makes the zod
   _input_ type diverge from the _output_ type, which fights react-hook-form's
   single generic. `listProductsSchema` coerces because it parses URL and REST
   strings and no form binds to it; `createProductSchema` doesn't, because the
   dialog does. When a form field is textual but the value is numeric, validate
   the string in a form-local schema and convert on submit — see how
   `feature-flags/components/flag-dialog.tsx` handles `rolloutPercentage`.

---

## Step 6 — `products.repository.ts` (Drizzle only)

**File:** `src/modules/products/products.repository.ts` _(new)_

```ts
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

/** `\`, `%` and `_` are LIKE metacharacters: searching "100%" must not scan the table. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function buildWhere(input: ListProductsInput): SQL | undefined {
  const clauses: SQL[] = [];

  const term = input.search.trim();
  if (term) {
    const pattern = likePattern(term);
    const searchClause = or(
      ilike(products.sku, pattern),
      ilike(products.name, pattern),
      ilike(products.description, pattern),
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
 * Both queries share the same `where` and run in parallel: the pager needs an
 * unpaged count, and running it after the rows would double the round trips on
 * every keystroke in the search box.
 */
async function list(
  input: ListProductsInput,
): Promise<{ rows: ProductRow[]; total: number }> {
  const where = buildWhere(input);
  const column = SORT_COLUMNS[input.sort];
  const orderBy = input.order === "asc" ? asc(column) : desc(column);

  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(products)
      .where(where)
      // `id` breaks ties, so a row can't show up on two pages when the sort
      // column holds duplicates — two products created in the same second, or
      // sharing a name.
      .orderBy(orderBy, asc(products.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db.select({ value: count() }).from(products).where(where),
  ]);

  return { rows, total: totals?.value ?? 0 };
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

export type { ProductValues };
```

**Boundaries of this layer — all four are load-bearing:**

- `import "server-only"` on line 1. A stray client import becomes a build error
  rather than a bundled DB driver.
- **No `requirePermission`, no `logAudit`, no zod parsing.** It receives
  already-validated input.
- **This is the only layer allowed dialect-specific SQL** (`ilike`,
  `` sql`…` ``).
- **Export a single object**, not loose functions — it's what makes
  `vi.mock("./products.repository")` a one-liner in the service test.

Four details in that file that are easy to get wrong:

1. **Escape LIKE metacharacters** before interpolating a search term
   (`likePattern`). Without it a search for `100%` matches every row and scans
   the table.
2. **`buildWhere` returns `undefined`, not `and()`,** when there are no filters.
   Passing an empty `and()` to Drizzle is not the same as omitting the clause.
3. **Add `asc(products.id)` as a tiebreaker** to every paged `orderBy`. With a
   non-unique sort column, Postgres is free to order ties differently between
   the query for page 1 and the query for page 2, and a row can appear on both
   or neither. `users.repository.ts` predates this rule — follow it in new code.
4. **Return `null` for "not found", never throw.** Deciding that a missing row is
   a `NotFoundError` is a service concern; a repository that throws can't be
   reused by a caller for whom absence is a normal answer (`isSkuTaken`).

One judgement call this module doesn't need but `users` does: when a row
contains fields the client must never see, the repository defines a projection
type (`UserListItem`) and a `toListItem` mapper, and returns _that_ instead of
the raw row. `ProductRow` has nothing credential-shaped in it, so returning it
directly is fine — but add the projection the moment a column shows up that
shouldn't leave the server (a cost price, an internal note).

---

## Step 7 — `products.service.ts` (the real work)

**File:** `src/modules/products/products.service.ts` _(new)_

**Every mutating method follows the same order. Do not reorder it.**

```ts
import "server-only";

import type { ProductRow } from "@/db/schema";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { cacheTags, invalidateQueryTags } from "@/modules/cache";
import { logAudit } from "@/modules/audit-log/audit-log.service";
import { requirePermission } from "@/modules/rbac/permissions.service";

import { productsRepository } from "./products.repository";
import {
  archiveProductSchema,
  createProductSchema,
  listProductsSchema,
  productIdSchema,
  updateProductSchema,
} from "./products.schema";

/**
 * Products.
 *
 * The layer where a request becomes a decision: authorise, validate, enforce
 * business rules, write, audit, invalidate — in that order, every time. Server
 * Actions and Route Handlers are both thin wrappers over this file, which is
 * what stops the two transports from drifting apart on who may do what.
 */

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function list(
  input: unknown,
): Promise<{ rows: ProductRow[]; total: number }> {
  await requirePermission("product", "read");
  const params = listProductsSchema.parse(input);
  return productsRepository.list(params);
}

async function findById(input: unknown): Promise<ProductRow> {
  await requirePermission("product", "read");
  const { id } = productIdSchema.parse(input);

  const row = await productsRepository.findById(id);
  if (!row) throw new NotFoundError("Product", id);
  return row;
}

/**
 * Aggregate counts for the dashboard card.
 *
 * Deliberately ungated, matching `featureFlagService.getStats` and the audit
 * log's: the dashboard renders for every signed-in user, and two integers
 * disclose nothing a viewer couldn't already see. Keep it that way — the moment
 * this returns a revenue figure or a row, it needs `requirePermission`.
 */
async function getStats(): Promise<{ total: number; archived: number }> {
  return productsRepository.stats();
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Products are read on admin screens only, so there is no Redis entry to drop —
 * just the Next data cache. A module whose rows sit on a hot path (a feature
 * flag, evaluated inside every render) would also call `cache.invalidateTags()`
 * here; see `src/modules/cache/README.md` for which layer solves what.
 */
function invalidate(id: string): void {
  invalidateQueryTags(cacheTags.products, cacheTags.product(id));
}

async function create(input: unknown): Promise<ProductRow> {
  await requirePermission("product", "create"); // 1. authorise
  const values = createProductSchema.parse(input); // 2. validate

  // 3. business rules
  if (await productsRepository.isSkuTaken(values.sku)) {
    throw new ConflictError(`SKU "${values.sku}" is already in use.`);
  }

  // 4. mutate
  const row = await productsRepository.insert({
    sku: values.sku,
    name: values.name,
    description: values.description ?? null,
    priceCents: values.priceCents,
    // New products start visible. Archiving is a separate, separately
    // permissioned step.
    archived: false,
  });

  // 5. audit
  await logAudit({
    action: "product.created",
    resourceType: "product",
    resourceId: row.id,
    after: snapshot(row),
  });

  invalidate(row.id); // 6. invalidate
  return row;
}

async function update(input: unknown): Promise<ProductRow> {
  await requirePermission("product", "update");
  const values = updateProductSchema.parse(input);

  const before = await productsRepository.findById(values.id);
  if (!before) throw new NotFoundError("Product", values.id);

  // No SKU conflict check here: `updateProductSchema` omits `sku`, so it can't
  // change. If you ever allow renaming one, this is where
  // `isSkuTaken(values.sku, values.id)` goes — with the `exceptId`, or every
  // save collides with itself.
  const row = await productsRepository.update(values.id, {
    name: values.name,
    description: values.description ?? null,
    priceCents: values.priceCents,
  });
  // Not redundant with the check above: a concurrent delete can land between
  // the read and the write.
  if (!row) throw new NotFoundError("Product", values.id);

  await logAudit({
    action: "product.updated",
    resourceType: "product",
    resourceId: row.id,
    before: snapshot(before),
    after: snapshot(row),
  });

  invalidate(row.id);
  return row;
}

/**
 * Archive and unarchive, behind their own `product:archive` permission.
 *
 * Split out of `update` for the reason `feature-flags` splits `toggle`: it is
 * the action you want to delegate to someone you would not trust to rewrite
 * prices.
 */
async function archive(input: unknown): Promise<ProductRow> {
  await requirePermission("product", "archive");
  const values = archiveProductSchema.parse(input);

  const before = await productsRepository.findById(values.id);
  if (!before) throw new NotFoundError("Product", values.id);

  // Already in the requested state: return without writing, so a double-click
  // can't put a meaningless "archived → archived" entry in the audit log.
  if (before.archived === values.archived) return before;

  const row = await productsRepository.update(values.id, {
    archived: values.archived,
  });
  if (!row) throw new NotFoundError("Product", values.id);

  await logAudit({
    action: values.archived ? "product.archived" : "product.unarchived",
    resourceType: "product",
    resourceId: row.id,
    before: { archived: before.archived },
    after: { archived: row.archived },
  });

  invalidate(row.id);
  return row;
}

async function remove(input: unknown): Promise<void> {
  await requirePermission("product", "delete");
  const { id } = productIdSchema.parse(input);

  const before = await productsRepository.findById(id);
  if (!before) throw new NotFoundError("Product", id);

  await productsRepository.remove(id);

  // Audit the whole row: after this, `before` is the only record it existed.
  await logAudit({
    action: "product.deleted",
    resourceType: "product",
    resourceId: id,
    before: snapshot(before),
  });

  invalidate(id);
}

/**
 * What the audit log stores for a product.
 *
 * Hand-written rather than the raw row: entries are retained for months and
 * read by people, so they should carry the fields that describe a business
 * change and nothing else. Logging a new column stays a deliberate decision.
 */
function snapshot(row: ProductRow): Record<string, unknown> {
  return {
    sku: row.sku,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    archived: row.archived,
  };
}

export const productsService = {
  list,
  findById,
  getStats,
  create,
  update,
  archive,
  remove,
};
```

Why this exact order:

| Step                          | Why it's where it is                                                                                                                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requirePermission` **first** | Before touching input. An unauthorised caller must not learn whether a SKU exists — validation errors leak that.                                                                                                                                                            |
| `parse` on `unknown`          | Service params are typed `unknown`, never the inferred type. The action layer forwards raw client payloads; zod is the boundary.                                                                                                                                            |
| Load `before` for updates     | Needed for the audit diff. Missing row → `NotFoundError`.                                                                                                                                                                                                                   |
| `logAudit` **in the service** | Not in the action, not in the route. That placement is the whole point: a new transport (REST, CLI, cron) reusing the service gets auditing for free and _cannot forget it_. `logAudit` never throws — a failed audit write must not roll back a completed business action. |
| Invalidate last               | Only after the write succeeded.                                                                                                                                                                                                                                             |

Five decisions in that file that the six-step order doesn't spell out:

1. **Reads are gated too.** `list` and `findById` call
   `requirePermission("product", "read")`. The `<Forbidden />` check on the page
   is UX; this one is the boundary, and it's the only one a REST client or a
   future CLI will hit.
2. **`getStats()` is the deliberate exception.** It returns two integers to a
   dashboard card that renders for every signed-in user, so it's ungated —
   matching `featureFlagService.getStats`. That exemption survives only as long
   as the return type stays aggregate; a revenue figure or a row needs the
   check back.
3. **`archive` returns early when nothing changes.** Without it a double-clicked
   toggle writes an `archived → archived` entry, and an audit log full of no-ops
   is one nobody reads.
4. **The second `if (!row)` is not redundant.** `findById` then `update` is two
   round trips; a concurrent delete lands between them and Drizzle returns no
   row. Same reason `remove` loads `before` first — after the DELETE, that
   snapshot is the only record the product existed.
5. **`update` doesn't check the SKU.** `updateProductSchema` omits it, so it
   can't change. If you relax that, `isSkuTaken(values.sku, values.id)` goes in
   the same slot as `create`'s check — and the `exceptId` argument is what stops
   every save colliding with itself.

**Caching:** the local `invalidate()` helper covers a paged admin list. Only
reach for the Redis layer (`cache.wrap(...)` + `cache.invalidateTags(...)`) when
a read is _hot on every request_ — that's why `feature-flags` and resolved
permission sets use it and `users` doesn't. Read
[`src/modules/cache/README.md`](../src/modules/cache/README.md) before adding it.

One constraint worth knowing before you call the service from somewhere new:
`invalidateQueryTags` wraps `revalidateTag`, which Next only permits inside a
Server Action or a Route Handler. Calling `create()` from a Server Component
render would throw there, not at the write. That's the intended shape anyway —
components read, actions write.

**The barrel export at the bottom is the module's public API.** Every function
above it is private by default; a caller that wants something else has to add it
to the object deliberately, and that one-line diff is the review moment for "is
this really the boundary?".

---

---

## Step 8 — `products.actions.ts` (thin)

**File:** `src/modules/products/products.actions.ts` _(new)_

```ts
"use server";

import { revalidatePath } from "next/cache";

import { withAction, type ActionResult } from "@/lib/action";

import { productsService } from "./products.service";

/**
 * Server Actions for the Products module.
 *
 * Thin by design: authorising, validating, auditing and cache invalidation all
 * happen in the service, so these only translate its result into something a
 * form can render and tell Next which routes went stale.
 *
 * Each returns the minimum the caller needs — an id, not the row. Everything
 * returned here crosses the network on every call.
 */

export async function createProductAction(
  input: unknown,
): Promise<ActionResult<{ id: string; sku: string }>> {
  return withAction("products.create", async () => {
    const product = await productsService.create(input);
    revalidatePath("/products");
    return { id: product.id, sku: product.sku };
  });
}

export async function updateProductAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return withAction("products.update", async () => {
    const product = await productsService.update(input);
    revalidatePath("/products");
    return { id: product.id };
  });
}

/**
 * Archiving is its own action rather than `update` with a flag set: it carries
 * its own permission (`product:archive`), so someone trusted to pull a product
 * off the shelf still can't rewrite its price.
 */
export async function archiveProductAction(
  input: unknown,
): Promise<ActionResult<{ id: string; archived: boolean }>> {
  return withAction("products.archive", async () => {
    const product = await productsService.archive(input);
    revalidatePath("/products");
    return { id: product.id, archived: product.archived };
  });
}

export async function deleteProductAction(
  input: unknown,
): Promise<ActionResult<void>> {
  return withAction("products.delete", async () => {
    await productsService.remove(input);
    revalidatePath("/products");
  });
}
```

**No logic belongs in this file.** Every wrapper does exactly three things: call
the service, `revalidatePath`, shape the return value. If you find yourself
writing an `if` here, it belongs in the service — that's the copy a Route
Handler and a cron job also get.

`withAction` (`src/lib/action.ts`) converts throws into a discriminated union:

```ts
{ ok: true; data: T }
{ ok: false; code; message; fieldErrors? }
```

That exists because a thrown error in a Server Action reaches the client as an
opaque digest — useless for putting _"that SKU is already in use"_ next to a
field. `ZodError` becomes `fieldErrors` (ready for `form.setError`), `AppError`s
keep their message, and everything else collapses to a generic one so a stack
trace can't leak a hostname.

Two conventions worth matching:

- **The name passed to `withAction` (`"products.create"`) is a log label**, not a
  route. It's what appears in the structured log when an action is rejected, so
  keep it `module.verb`.
- **`revalidatePath` here, `invalidateQueryTags` in the service.** They're
  different caches: this one re-renders the route, that one drops the cached
  query. `users.actions.ts` adds `revalidatePath("/", "layout")` when a change
  affects the shell — do the same if a product ever appears in the sidebar.

---

## Step 9 — The page (Server Component)

**File:** `src/app/(dashboard)/products/page.tsx` _(new)_

```tsx
import type { Metadata } from "next";

import { Forbidden } from "@/components/shared/forbidden";
import { parseTableParams } from "@/lib/table-params";
import { ProductsView } from "@/modules/products/components/products-view";
import { productsService } from "@/modules/products/products.service";
import { hasPermission } from "@/modules/rbac/permissions.service";

export const metadata: Metadata = { title: "Products" };

/**
 * Products index.
 *
 * Table state arrives as search params and goes straight to the service, so the
 * database does the paging and the client only ever receives one page.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The friendly screen for a signed-in user who lacks the permission. Not the
  // security boundary — `productsService.list` enforces the same check, and
  // that is what a REST client or a future CLI hits.
  if (!(await hasPermission("product", "read"))) {
    return <Forbidden />;
  }

  const params = parseTableParams(await searchParams);

  const { rows, total } = await productsService.list({
    page: params.page,
    pageSize: params.pageSize,
    // `parseTableParams` types `sort` as `string | null` because it is generic
    // over every table; the service's zod enum is what pins it to a real
    // column, rejecting anything else.
    sort: params.sort ?? "createdAt",
    order: params.order,
    search: params.search,
    status: params.filters.status,
  });

  return (
    <ProductsView
      products={rows.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        description: product.description,
        priceCents: product.priceCents,
        archived: product.archived,
        // Explicit projection, not a spread: `Date` has no wire format across
        // the RSC boundary, and a column added to the table later must not
        // start reaching the browser by accident.
        createdAt: product.createdAt.toISOString(),
      }))}
      totalRows={total}
      params={params}
    />
  );
}
```

Four things to get right:

- **`searchParams` is a `Promise` in Next 16.** Always `await` it.
- **`hasPermission` + `<Forbidden />`, not `requirePermission`.** At page level
  you want the friendly screen; the service's check still throws for anyone who
  arrives another way.
- **`parseTableParams`** (`src/lib/table-params.ts`) clamps `page`/`pageSize`, so
  `?pageSize=1e9` never reaches the repository. Anything not in its reserved set
  lands in `params.filters` — which is how `?status=archived` gets through
  without the page knowing about that filter specifically.
- **Map rows explicitly.** `Date` → ISO string, and drop what the UI doesn't
  render.

Optional siblings: `loading.tsx` for the streaming skeleton (see
`app/(dashboard)/roles/loading.tsx`) and `error.tsx` if this route needs a
boundary narrower than the group's.

---

## Step 10 — The view (Client Component)

**File:** `src/modules/products/components/products-view.tsx` _(new)_

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { TableToolbar } from "@/components/shared/table-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TableParams } from "@/lib/table-params";
import {
  archiveProductAction,
  deleteProductAction,
} from "@/modules/products/products.actions";
import { usePermission } from "@/modules/rbac/permission-provider";

import { ProductDialog } from "./product-dialog";

/**
 * The row shape this view renders — declared here, not imported from the
 * schema, because it is the contract between the page and the table. Dates are
 * strings and money is an integer: both cross the server/client boundary as
 * primitives.
 */
export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  priceCents: number;
  archived: boolean;
  createdAt: string;
}

/**
 * Fixed locale, deliberately.
 *
 * This is a Client Component, but it still renders on the server first, where
 * `undefined` resolves to the server's locale rather than the viewer's — the
 * two disagree and React reports a hydration mismatch. Pick a locale explicitly
 * here, or format inside `useEffect` if it must follow the browser.
 */
const priceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatPrice(cents: number): string {
  return priceFormatter.format(cents / 100);
}

export function ProductsView({
  products,
  totalRows,
  params,
}: {
  products: ProductRow[];
  totalRows: number;
  params: TableParams;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const canCreate = usePermission("product", "create");
  const canUpdate = usePermission("product", "update");
  const canArchive = usePermission("product", "archive");
  const canDelete = usePermission("product", "delete");
  const hasRowActions = canUpdate || canArchive || canDelete;

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(product: ProductRow) {
    setEditing(product);
    setDialogOpen(true);
  }

  async function toggleArchived(product: ProductRow) {
    // Disable this row's controls while the action is in flight, so a second
    // click can't queue a contradictory write.
    setPendingId(product.id);
    const result = await archiveProductAction({
      id: product.id,
      archived: !product.archived,
    });
    setPendingId(null);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(
      result.data.archived
        ? `"${product.name}" archived.`
        : `"${product.name}" restored.`,
    );
    // The server re-renders the page with fresh rows; nothing is mutated
    // locally, so the table can't drift from the database.
    router.refresh();
  }

  async function remove(product: ProductRow) {
    const result = await deleteProductAction({ id: product.id });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Product "${product.sku}" deleted.`);
    router.refresh();
  }

  const columns: DataTableColumn<ProductRow>[] = [
    {
      id: "product",
      header: "Product",
      sortKey: "name",
      cell: ({ row }) => <ProductCell product={row.original} />,
    },
    {
      id: "price",
      header: "Price",
      sortKey: "priceCents",
      cell: ({ row }) => (
        <span className="font-mono text-sm whitespace-nowrap tabular-nums">
          {formatPrice(row.original.priceCents)}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) =>
        row.original.archived ? (
          <Badge variant="secondary">archived</Badge>
        ) : (
          <Badge variant="outline">active</Badge>
        ),
    },
    {
      id: "createdAt",
      header: "Added",
      sortKey: "createdAt",
      cell: ({ row }) => (
        <time
          dateTime={row.original.createdAt}
          className="text-sm whitespace-nowrap text-muted-foreground"
        >
          {new Date(row.original.createdAt).toLocaleDateString("en-US")}
        </time>
      ),
    },
  ];

  if (hasRowActions) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => <RowActions product={row.original} />,
    });
  }

  function RowActions({ product }: { product: ProductRow }) {
    return (
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${product.name}`}
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-48">
            {canUpdate ? (
              <DropdownMenuItem onSelect={() => openEdit(product)}>
                <Pencil className="size-4" aria-hidden />
                Edit details
              </DropdownMenuItem>
            ) : null}

            {canArchive ? (
              <DropdownMenuItem
                disabled={pendingId === product.id}
                onSelect={() => void toggleArchived(product)}
              >
                {product.archived ? (
                  <>
                    <ArchiveRestore className="size-4" aria-hidden />
                    Restore
                  </>
                ) : (
                  <>
                    <Archive className="size-4" aria-hidden />
                    Archive
                  </>
                )}
              </DropdownMenuItem>
            ) : null}

            {canDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  // Deletion is irreversible, so the menu item opens the
                  // confirm dialog instead of firing the action.
                  onSelect={(event) => event.preventDefault()}
                  asChild
                >
                  <ConfirmDialog
                    trigger={
                      <button
                        type="button"
                        className="flex w-full items-center gap-2"
                      >
                        <Trash2 className="size-4" aria-hidden />
                        Delete
                      </button>
                    }
                    title={`Delete ${product.name}?`}
                    description={
                      <p>
                        This permanently removes the product. Archiving keeps it
                        out of the catalogue without losing its history — prefer
                        that unless the row was created by mistake.
                      </p>
                    }
                    confirmLabel="Delete product"
                    destructive
                    confirmPhrase={product.sku}
                    onConfirm={() => remove(product)}
                  />
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Products"
        description="The catalogue. Actions you can't perform are hidden here and re-checked on the server."
        actions={
          canCreate ? (
            <Button type="button" onClick={openCreate}>
              <Plus className="size-4" aria-hidden />
              New product
            </Button>
          ) : null
        }
      />

      <DataTable
        columns={columns}
        data={products}
        totalRows={totalRows}
        params={params}
        getRowId={(product) => product.id}
        emptyTitle="No products yet"
        emptyDescription="Add the first one, or import your catalogue."
        emptyAction={
          canCreate ? (
            <Button type="button" onClick={openCreate}>
              <Package className="size-4" aria-hidden />
              Add a product
            </Button>
          ) : null
        }
        toolbar={
          <TableToolbar
            searchPlaceholder="Search by SKU or name…"
            filters={[
              {
                name: "status",
                label: "Status",
                options: [
                  { value: "active", label: "Active" },
                  { value: "archived", label: "Archived" },
                ],
              },
            ]}
          />
        }
        renderMobileCard={(product) => (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <ProductCell product={product} />
              {hasRowActions ? <RowActions product={product} /> : null}
            </div>

            <div className="flex items-center gap-2">
              <span className="font-mono text-sm tabular-nums">
                {formatPrice(product.priceCents)}
              </span>
              {product.archived ? (
                <Badge variant="secondary">archived</Badge>
              ) : (
                <Badge variant="outline">active</Badge>
              )}
            </div>

            {product.description ? (
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {product.description}
              </p>
            ) : null}
          </div>
        )}
      />

      <ProductDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={editing}
      />
    </>
  );
}

function ProductCell({ product }: { product: ProductRow }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{product.name}</p>
      <p className="truncate font-mono text-xs text-muted-foreground">
        {product.sku}
      </p>
    </div>
  );
}
```

Five things this file is doing on purpose:

1. **`usePermission` hides, it never enforces.** Every one of these four booleans
   has a `requirePermission` twin in the service. Prefer hiding over disabling: a
   disabled button still advertises a capability the user doesn't have.
2. **`sortKey` must match the service's `sort` enum.** `"priceCents"`,
   `"name"`, `"createdAt"` — a typo here produces a header that sorts by nothing
   and a zod error on click.
3. **`totalRows` is the server's count**, not `products.length`. It drives the
   pager; passing the page length silently caps the table at one page.
4. **`router.refresh()` after every mutation, and no local state mutation.** The
   server re-renders the page from the database, so the table cannot drift out of
   sync with what was actually written.
5. **`renderMobileCard` is not optional in practice.** Without it the `< md`
   fallback stacks every column, including the actions cell.

---

## Step 10b — The dialog (Client Component)

**File:** `src/modules/products/components/product-dialog.tsx` _(new)_

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  FormAlert,
  TextField,
  TextareaField,
} from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/action";
import {
  createProductAction,
  updateProductAction,
} from "@/modules/products/products.actions";
import { skuField } from "@/modules/products/products.schema";

import type { ProductRow } from "./products-view";

/**
 * The form's own schema, which is not `createProductSchema`.
 *
 * The service stores an integer number of cents; a human types `19.99`. So the
 * form validates the string it actually edits and converts on submit. Reaching
 * for `z.coerce.number()` instead would make the zod input and output types
 * diverge, which react-hook-form's single generic can't express.
 */
const productFormSchema = z.object({
  sku: skuField,
  name: z.string().trim().min(1, "Name is required.").max(160),
  description: z.string().trim().max(2000),
  price: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 19.99.")
    .refine((value) => Number(value) <= 1_000_000, "That's above the maximum."),
});
type ProductFormInput = z.infer<typeof productFormSchema>;

/**
 * Server field name → form field name.
 *
 * They differ wherever the form edits a different representation of a column,
 * so a `priceCents` error from the server still lands under the price input
 * rather than in the generic banner.
 */
const FIELD_MAP: Record<string, keyof ProductFormInput> = {
  sku: "sku",
  name: "name",
  description: "description",
  priceCents: "price",
};

/**
 * One dialog, two modes: `product === null` creates, otherwise it edits.
 *
 * The body is keyed by product id so Radix's unmount-on-close plus the key give
 * every open a fresh `useForm` with the right defaults — no "reset the form in
 * an effect" cascade, and no flash of the previously edited row.
 */
export function ProductDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductRow | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <ProductDialogBody
          key={product?.id ?? "new"}
          product={product}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProductDialogBody({
  product,
  onDone,
}: {
  product: ProductRow | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const isEdit = product !== null;
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ProductFormInput>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      sku: product?.sku ?? "",
      name: product?.name ?? "",
      description: product?.description ?? "",
      // Integer cents → the decimal string the input edits.
      price: product ? (product.priceCents / 100).toFixed(2) : "0.00",
    },
  });

  /**
   * Puts server-side validation errors on the fields they belong to.
   *
   * Returns whether anything was placed: if not, the message goes in the banner
   * instead, so a `CONFLICT` or `FORBIDDEN` can never fail silently.
   */
  function applyServerErrors(
    result: Extract<ActionResult<unknown>, { ok: false }>,
  ): boolean {
    let applied = false;

    for (const [serverField, messages] of Object.entries(
      result.fieldErrors ?? {},
    )) {
      const field = FIELD_MAP[serverField];
      const message = messages[0];
      if (!field || !message) continue;
      form.setError(field, { type: "server", message });
      applied = true;
    }

    return applied;
  }

  async function onSubmit(values: ProductFormInput) {
    setFormError(null);

    const payload = {
      name: values.name,
      description: values.description || undefined,
      // `Math.round` is not decoration: 19.99 * 100 is 1998.9999999999998 in
      // IEEE 754, and `priceCents` is an integer column.
      priceCents: Math.round(Number(values.price) * 100),
    };

    const result = isEdit
      ? await updateProductAction({ id: product.id, ...payload })
      : await createProductAction({ sku: values.sku, ...payload });

    if (!result.ok) {
      if (!applyServerErrors(result)) setFormError(result.message);
      return;
    }

    toast.success(isEdit ? "Product updated." : `Product ${values.sku} added.`);
    router.refresh();
    onDone();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? `Edit ${product.name}` : "New product"}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? "The SKU is fixed once a product exists — other systems reference it."
            : "Pick a SKU carefully: it identifies this product everywhere and can't be changed later."}
        </DialogDescription>
      </DialogHeader>

      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid gap-4"
      >
        <FormAlert message={formError} />

        {isEdit ? (
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            <span className="text-muted-foreground">SKU: </span>
            <span className="font-mono">{product.sku}</span>
          </div>
        ) : (
          <TextField
            control={form.control}
            name="sku"
            label="SKU"
            placeholder="TSHIRT-BLK-M"
            autoComplete="off"
            description="Uppercase letters, digits and hyphens."
          />
        )}

        <TextField control={form.control} name="name" label="Name" />

        <TextField
          control={form.control}
          name="price"
          label="Price (USD)"
          placeholder="19.99"
          description="Stored as an integer number of cents."
        />

        <TextareaField
          control={form.control}
          name="description"
          label="Description"
          placeholder="What it is, in a sentence or two."
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : isEdit ? (
              "Save changes"
            ) : (
              "Create product"
            )}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
```

The money handling is the part worth transplanting into any module that stores
an integer:

- **The form schema is not the service schema.** It validates `price` as a
  string, because that is what the user types. `createProductSchema` validates
  `priceCents` as an integer, because that is what the column holds.
- **`Math.round(Number(value) * 100)`**, never `Number(value) * 100`. In IEEE
  754, `19.99 * 100` is `1998.9999999999998`, and Postgres rejects it for an
  `integer` column — after the user has filled the whole form.
- **`(cents / 100).toFixed(2)`** on the way back in, so editing a product and
  saving it unchanged is a genuine no-op.
- **`FIELD_MAP`** exists because the two names differ. Without it, a server-side
  `priceCents` error would fall through to the banner and the price input would
  look fine.

`skuField` is imported from the module's own schema rather than re-declared, so
the client-side regex and the server-side one cannot drift.

---

## Step 11 — Navigation

**File:** `src/components/layout/nav-config.ts` _(edit)_

```ts
import { Package } from "lucide-react";

// inside an existing group, or a new one
{
  title: "Products",
  href: "/products",
  icon: Package,
  description: "Catalogue, pricing and availability",
  permission: "product:read",   // typechecked against the statement
  matchNested: true,            // /products/123 highlights /products
}
```

One entry lights up **four** surfaces: sidebar, mobile drawer, command palette
and breadcrumbs. `permission` is a `PermissionKey`, so it only compiles because
Step 2 added `product` to the statement — and the link disappears for anyone
without the grant.

---

## Step 12 — REST route _(optional)_

**File:** `src/app/api/products/route.ts` _(new)_

```ts
import { NextResponse } from "next/server";

import { withApiHandler } from "@/lib/api";
import { productsService } from "@/modules/products/products.service";

/**
 * REST view of the Products module, for integrations and scripts that need HTTP
 * semantics. It funnels into the same service as the dashboard, so
 * authorization, validation and auditing are identical either way.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiHandler("product", "read", async (request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const { rows, total } = await productsService.list(params);
  return NextResponse.json({ data: rows, meta: { total } });
});

export const POST = withApiHandler("product", "create", async (request) => {
  const product = await productsService.create(await request.json());
  return NextResponse.json({ data: product }, { status: 201 });
});
```

`withApiHandler` (`src/lib/api.ts`) is **default-deny — a permission is
mandatory**. There is no "public" variant on purpose: a route reachable without
auth is written _without_ the wrapper, so the decision shows up in the diff
instead of hiding in an options object. It also owns request-id propagation and
error → status mapping.

Note that `params` goes in as raw strings — this is exactly why
`listProductsSchema` uses `z.coerce` while the form schemas don't.

---

## Step 13 — Tests

| File                                                     | Runner                          | Covers                                                          |
| -------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------- |
| `src/modules/products/products.service.test.ts`          | vitest **node** (`*.test.ts`)   | permission gate, validation, conflict, audit calls, no-op guard |
| `src/modules/products/components/products-view.test.tsx` | vitest **jsdom** (`*.test.tsx`) | rendering, permission-hidden UI                                 |
| `e2e/products.spec.ts`                                   | Playwright, real Postgres       | full CRUD against the running app, plus RBAC denial over HTTP   |

Coverage is scoped to `src/modules/**` and `src/lib/**` but **excludes**
`*.repository.ts`, `*.schema.ts`, `*.actions.ts` and `components/` —
repositories are covered by Playwright against a real database, and the other
three have no logic of their own. So **the service test is the one that counts.**

### The service test

**File:** `src/modules/products/products.service.test.ts` _(new)_

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";

import { productsRepository } from "./products.repository";
import { productsService } from "./products.service";

/**
 * The repository is mocked wholesale — these tests are about the decisions the
 * service makes, not about SQL. Exporting the repository as one object is what
 * makes this a single `vi.mock` rather than a per-function stub.
 */
vi.mock("./products.repository", () => ({
  productsRepository: {
    list: vi.fn(),
    findById: vi.fn(),
    findBySku: vi.fn(),
    isSkuTaken: vi.fn(),
    stats: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("@/modules/audit-log/audit-log.service", () => ({ logAudit: vi.fn() }));

const requirePermission = vi.hoisted(() => vi.fn());
vi.mock("@/modules/rbac/permissions.service", () => ({ requirePermission }));

const repo = vi.mocked(productsRepository);
const { logAudit } = await import("@/modules/audit-log/audit-log.service");

const product = {
  id: "product-1",
  sku: "TSHIRT-BLK-M",
  name: "Black t-shirt (M)",
  description: null,
  priceCents: 1999,
  archived: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const validInput = {
  sku: "TSHIRT-BLK-M",
  name: "Black t-shirt (M)",
  priceCents: 1999,
};

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ permissionKeys: new Set() });
});

describe("create", () => {
  it("writes the row, then the audit entry", async () => {
    repo.isSkuTaken.mockResolvedValue(false);
    repo.insert.mockResolvedValue(product);

    const created = await productsService.create(validInput);

    expect(created).toBe(product);
    expect(repo.insert).toHaveBeenCalledWith({
      sku: "TSHIRT-BLK-M",
      name: "Black t-shirt (M)",
      description: null,
      priceCents: 1999,
      archived: false,
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "product.created",
        resourceType: "product",
        resourceId: "product-1",
      }),
    );
  });

  it("rejects a duplicate SKU with a message an operator can act on", async () => {
    repo.isSkuTaken.mockResolvedValue(true);

    await expect(productsService.create(validInput)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("rejects invalid input before touching the database", async () => {
    await expect(
      productsService.create({ ...validInput, sku: "lower-case" }),
    ).rejects.toThrow();
    expect(repo.isSkuTaken).not.toHaveBeenCalled();
  });

  /**
   * The important one. If `requirePermission` ever stops throwing, or moves
   * below the parse, this is the test that fails.
   */
  it("checks the permission before anything else", async () => {
    requirePermission.mockRejectedValue(new ForbiddenError());

    await expect(productsService.create(validInput)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(requirePermission).toHaveBeenCalledWith("product", "create");
    expect(repo.isSkuTaken).not.toHaveBeenCalled();
    expect(repo.insert).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("update", () => {
  it("audits the before and after snapshots", async () => {
    repo.findById.mockResolvedValue(product);
    repo.update.mockResolvedValue({ ...product, priceCents: 2499 });

    await productsService.update({
      id: product.id,
      name: product.name,
      priceCents: 2499,
    });

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "product.updated",
        before: expect.objectContaining({ priceCents: 1999 }),
        after: expect.objectContaining({ priceCents: 2499 }),
      }),
    );
  });

  it("throws NotFoundError for a missing row", async () => {
    repo.findById.mockResolvedValue(null);

    await expect(
      productsService.update({ id: "nope", name: "x", priceCents: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe("archive", () => {
  it("names the action for the direction of travel", async () => {
    repo.findById.mockResolvedValue({ ...product, archived: true });
    repo.update.mockResolvedValue({ ...product, archived: false });

    await productsService.archive({ id: product.id, archived: false });

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "product.unarchived" }),
    );
  });

  it("is a no-op when the row is already in the requested state", async () => {
    repo.findById.mockResolvedValue(product); // archived: false

    const result = await productsService.archive({
      id: product.id,
      archived: false,
    });

    expect(result).toBe(product);
    // No write, and — the point of the early return — no misleading
    // "archived → archived" entry in the audit log.
    expect(repo.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("remove", () => {
  it("keeps the deleted row in the audit trail", async () => {
    repo.findById.mockResolvedValue(product);

    await productsService.remove({ id: product.id });

    expect(repo.remove).toHaveBeenCalledWith(product.id);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "product.deleted",
        before: expect.objectContaining({ sku: "TSHIRT-BLK-M" }),
      }),
    );
  });

  it("refuses to delete what it can't find", async () => {
    repo.findById.mockResolvedValue(null);

    await expect(productsService.remove({ id: "nope" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(repo.remove).not.toHaveBeenCalled();
  });
});
```

Notes on the shape:

- **No `next/cache` mock is needed.** `vitest.setup.node.ts` already stubs
  `revalidateTag` / `revalidatePath` globally, and unsets `REDIS_URL` so the
  cache falls back to its in-memory store.
- **Assert the negatives.** Half these tests check that something did _not_
  happen — no insert after a conflict, no audit entry after a `ForbiddenError`.
  A suite that only walks happy paths would still pass with the permission check
  deleted.
- **`toBeInstanceOf(ConflictError)`, not `toThrow(/message/)`.** The class is the
  contract — it's what maps to HTTP 409 and to the `code` a form reads. The
  wording is not.

### The e2e spec

**File:** `e2e/products.spec.ts` _(new)_

```ts
import { expect, test } from "@playwright/test";

import { adminStatePath, unique, viewerStatePath } from "./fixtures";

test.describe("products", () => {
  test.use({ storageState: adminStatePath });

  test("create, archive and delete round-trip through the UI", async ({
    page,
  }) => {
    const sku = unique("E2E-SKU").toUpperCase();

    await page.goto("/products");

    // ---- create -----------------------------------------------------------
    await page.getByRole("button", { name: "New product" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "SKU", exact: true }).fill(sku);
    await dialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("E2E test product");
    await dialog
      .getByRole("textbox", { name: "Price (USD)", exact: true })
      .fill("19.99");
    await dialog.getByRole("button", { name: "Create product" }).click();

    await expect(dialog).toBeHidden();

    const row = page.getByRole("row", { name: new RegExp(sku) });
    await expect(row).toBeVisible();
    // Cents in, dollars out: the round-trip through the integer column is the
    // thing worth asserting.
    await expect(row).toContainText("$19.99");

    // ---- archive ----------------------------------------------------------
    await row.getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect(page.getByText(/archived/i).first()).toBeVisible();

    // The status filter is URL state, so this also proves the filter survives a
    // reload and is linkable.
    await page.goto("/products?status=archived");
    await expect(
      page.getByRole("row", { name: new RegExp(sku) }),
    ).toBeVisible();

    // ---- delete -----------------------------------------------------------
    await page
      .getByRole("row", { name: new RegExp(sku) })
      .getByRole("button", { name: /^Actions for/ })
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    // Type-to-confirm: the dialog must not accept a bare click.
    const confirm = page.getByRole("alertdialog");
    await expect(
      confirm.getByRole("button", { name: "Delete product" }),
    ).toBeDisabled();
    await confirm.getByRole("textbox").fill(sku);
    await confirm.getByRole("button", { name: "Delete product" }).click();

    await expect(page.getByRole("row", { name: new RegExp(sku) })).toBeHidden();
  });
});

/**
 * The other half of the feature: a role without the permission must not reach
 * it, in the UI *or* over HTTP. Hiding the button is not the test — a viewer
 * with a REST client is.
 */
test.describe("products — viewer", () => {
  test.use({ storageState: viewerStatePath });

  test("a viewer can read but not write", async ({ page, request }) => {
    await page.goto("/products");

    await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New product" }),
    ).toBeHidden();

    const response = await request.post("/api/products", {
      data: { sku: "E2E-DENIED", name: "Denied", priceCents: 100 },
    });
    expect(response.status()).toBe(403);
  });
});
```

- **Selectors are roles and accessible names**, never CSS classes or test ids. If
  `getByRole("button", { name: "Actions for …" })` can't find the row menu, that
  is a real accessibility defect, and the test failing is the point.
- **`unique()`** from `fixtures.ts` keeps re-runs from colliding on the unique
  SKU index.
- **The storage states** are written by `global.setup.ts`; `viewerStatePath` is
  the seeded read-only role, which is what makes the denial half meaningful.
- **The 403 assertion needs Step 12.** Drop that block if you skipped the REST
  route, or point it at the Server Action instead.

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm test:e2e
```

---

## Final checklist

**Shared files touched (4):**

- [ ] `src/db/schema/index.ts` — `export * from "./products"`
- [ ] `src/lib/permissions.ts` — `statement.product` + `SYSTEM_ROLES` grants
- [ ] `src/modules/audit-log/audit-log.schema.ts` — actions + resource type
- [ ] `src/components/layout/nav-config.ts` — one nav entry

_(+ `src/modules/cache/cache-keys.ts` if you cache)_

**New files (9, plus the optional route):**

- [ ] `src/db/schema/products.ts` — step 1
- [ ] `src/modules/products/products.schema.ts` — step 5
- [ ] `src/modules/products/products.repository.ts` — step 6
- [ ] `src/modules/products/products.service.ts` — step 7
- [ ] `src/modules/products/products.actions.ts` — step 8
- [ ] `src/app/(dashboard)/products/page.tsx` — step 9
- [ ] `src/modules/products/components/products-view.tsx` — step 10
- [ ] `src/modules/products/components/product-dialog.tsx` — step 10b
- [ ] `src/modules/products/products.service.test.ts` + `e2e/products.spec.ts` —
      step 13
- [ ] _(optional)_ `src/app/api/products/route.ts` — step 12

**Commands, in order:**

```bash
pnpm db:generate && pnpm db:migrate   # after step 1
pnpm db:seed                          # after step 2
pnpm typecheck && pnpm lint && pnpm test
pnpm test:e2e                         # needs the app + Postgres running
```

**Invariants you must not break:**

1. Authorization only ever in the **service** (and `withApiHandler`) — never only
   in the UI.
2. `logAudit` in the **service**, never in the action or the route.
3. Repository = Drizzle only. No auth, no audit, no zod.
4. `"server-only"` at the top of every repository and service.
5. `Date` → ISO string before crossing to a Client Component.
6. `usePermission` hides UI; it never decides anything. Every client check has a
   `requirePermission` twin in the service.

The deletion test tells you it's structured right: removing this module should be
`rm -rf src/modules/products src/app/\(dashboard\)/products src/db/schema/products.ts`
plus reverting four small edits.
