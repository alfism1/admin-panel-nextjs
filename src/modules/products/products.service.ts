import "server-only";

import type { ProductRow } from "@/db/schema";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { cacheTags, invalidateQueryTags } from "@/modules/cache";
import { logAudit } from "@/modules/audit-log/audit-log.service";
import { requirePermission } from "@/modules/rbac/permissions.service";

import { productsRepository, type ProductPage } from "./products.repository";
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

async function list(input: unknown): Promise<ProductPage> {
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
