import "server-only";

import { ConflictError, NotFoundError } from "@/lib/errors";
import type { ActionFor, Resource } from "@/lib/permissions";
import { logAudit } from "@/modules/audit-log/audit-log.service";
import type {
  AuditAction,
  AuditResourceType,
} from "@/modules/audit-log/audit-log.schema";
import { invalidateQueryTags } from "@/modules/cache";
import { requirePermission } from "@/modules/rbac/permissions.service";

import type { ResourceDescriptor, ResourceRecord } from "./define";
import type {
  ResourceListInput,
  ResourceRepository,
  ResourceRow,
} from "./repository";

/**
 * The generic service layer.
 *
 * The layer where a request becomes a decision: authorise, validate, enforce
 * business rules, write, audit, invalidate — in that order, every time. Server
 * Actions and Route Handlers are both thin wrappers over this, which is what
 * stops the two transports from drifting apart on who may do what.
 *
 * Writing that order out once rather than per module is the point. A module can
 * no longer forget the audit call or put the permission check after the write,
 * because it no longer writes the sequence at all.
 */

export interface ResourceRules {
  /** Runs after validation and the uniqueness checks, before the insert. */
  beforeCreate?: (values: Record<string, unknown>) => Promise<void> | void;
  /** Runs before the update. `before` is the current row. */
  beforeUpdate?: (
    values: Record<string, unknown>,
    before: ResourceRow,
  ) => Promise<void> | void;
  /** Runs before the delete. Throw to refuse it. */
  beforeDelete?: (before: ResourceRow) => Promise<void> | void;
  /**
   * What the audit log stores for a row. Defaults to the declared fields.
   *
   * Entries are retained for months and read by people, so they should carry
   * the fields that describe a business change and nothing else — logging a new
   * column stays a deliberate decision.
   */
  snapshot?: (row: ResourceRow) => Record<string, unknown>;
}

export interface ResourceService {
  list: (input: unknown) => Promise<{
    records: ResourceRecord[];
    total: number;
    totalCapped: boolean;
  }>;
  findById: (input: unknown) => Promise<ResourceRow>;
  stats: () => Promise<{ total: number; archived: number }>;
  create: (input: unknown) => Promise<ResourceRow>;
  update: (input: unknown) => Promise<ResourceRow>;
  archive: (input: unknown) => Promise<ResourceRow>;
  remove: (input: unknown) => Promise<void>;
}

/**
 * A row as the browser receives it.
 *
 * An explicit projection over the declared fields, not a spread: `Date` has no
 * wire format across the RSC boundary, and a column added to the table later
 * must not start reaching the browser by accident.
 */
export function serializeRecord(
  descriptor: ResourceDescriptor,
  row: ResourceRow,
): ResourceRecord {
  const record: Record<string, unknown> = { id: row.id };

  for (const [name] of descriptor.fieldEntries) {
    const value = row[name];
    record[name] =
      value instanceof Date ? value.toISOString() : (value ?? null);
  }

  if (descriptor.archivable) record.archived = Boolean(row.archived);

  const createdAt = row.createdAt;
  if (createdAt instanceof Date) record.createdAt = createdAt.toISOString();
  else if (typeof createdAt === "string") record.createdAt = createdAt;

  return record as ResourceRecord;
}

export function createResourceService(
  descriptor: ResourceDescriptor,
  options: { repository: ResourceRepository; rules?: ResourceRules },
): ResourceService {
  const { repository, rules = {} } = options;

  // The descriptor's name is a registered resource, so these casts are the
  // boundary between the generic framework and the typed permission statement
  // rather than a loosening of it.
  const resource = descriptor.name as Resource;
  const permit = (action: string) =>
    requirePermission(resource, action as ActionFor<Resource>);

  const snapshot =
    rules.snapshot ??
    ((row: ResourceRow) => {
      const values: Record<string, unknown> = {};
      for (const [name] of descriptor.fieldEntries) values[name] = row[name];
      if (descriptor.archivable) values.archived = row.archived;
      return values;
    });

  function audit(
    suffix: string,
    resourceId: string,
    before?: Record<string, unknown> | null,
    after?: Record<string, unknown> | null,
  ) {
    return logAudit({
      action: `${descriptor.name}.${suffix}` as AuditAction,
      resourceType: descriptor.name as AuditResourceType,
      resourceId,
      before,
      after,
    });
  }

  function invalidate(id: string): void {
    invalidateQueryTags(descriptor.cacheTag, descriptor.recordCacheTag(id));
  }

  /**
   * Rejects a duplicate before the driver does, so the user sees "that SKU is
   * already in use" against the field instead of a constraint violation.
   */
  async function assertUnique(
    values: Record<string, unknown>,
    exceptId?: string,
  ): Promise<void> {
    for (const name of descriptor.uniqueFields) {
      const value = values[name];
      if (value === undefined) continue;
      if (await repository.isTaken(name, value, exceptId)) {
        const label = descriptor.fields[name]!.label;
        throw new ConflictError(
          `${label} "${String(value)}" is already in use.`,
        );
      }
    }
  }

  async function requireRow(id: string): Promise<ResourceRow> {
    const row = await repository.findById(id);
    if (!row) throw new NotFoundError(descriptor.label, id);
    return row;
  }

  // ---- reads ---------------------------------------------------------------

  async function list(input: unknown) {
    await permit("read");
    const params = descriptor.listSchema.parse(input) as ResourceListInput;
    const page = await repository.list(params);
    return {
      records: page.rows.map((row) => serializeRecord(descriptor, row)),
      total: page.total,
      totalCapped: page.totalCapped,
    };
  }

  async function findById(input: unknown): Promise<ResourceRow> {
    await permit("read");
    const { id } = descriptor.idSchema.parse(input) as { id: string };
    return requireRow(id);
  }

  /**
   * Aggregate counts for the dashboard card.
   *
   * Deliberately ungated, matching the audit log's and the feature flags': the
   * dashboard renders for every signed-in user, and two integers disclose
   * nothing a viewer couldn't already see. Keep it that way — the moment this
   * returns a revenue figure or a row, it needs a permission check.
   */
  function stats() {
    return repository.stats();
  }

  // ---- writes --------------------------------------------------------------

  async function create(input: unknown): Promise<ResourceRow> {
    await permit("create"); // 1. authorise
    const values = descriptor.createSchema.parse(input) as Record<
      string,
      unknown
    >;

    await assertUnique(values); // 2. validate
    await rules.beforeCreate?.(values); // 3. business rules

    const row = await repository.insert(withNulls(values)); // 4. mutate
    await audit("created", row.id, null, snapshot(row)); // 5. audit
    invalidate(row.id); // 6. invalidate
    return row;
  }

  async function update(input: unknown): Promise<ResourceRow> {
    await permit("update");
    const parsed = descriptor.updateSchema.parse(input) as Record<
      string,
      unknown
    > & { id: string };
    const { id, ...values } = parsed;

    const before = await requireRow(id);
    await assertUnique(values, id);
    await rules.beforeUpdate?.(values, before);

    const row = await repository.update(id, withNulls(values));
    // Not redundant with `requireRow` above: a concurrent delete can land
    // between the read and the write.
    if (!row) throw new NotFoundError(descriptor.label, id);

    await audit("updated", row.id, snapshot(before), snapshot(row));
    invalidate(row.id);
    return row;
  }

  /**
   * Archive and unarchive, behind their own `archive` permission.
   *
   * Split out of `update` so it can be delegated to someone you would not trust
   * to rewrite the rest of the row.
   */
  async function archive(input: unknown): Promise<ResourceRow> {
    if (!descriptor.archivable) {
      throw new NotFoundError(descriptor.label, "archive");
    }
    await permit("archive");
    const { id, archived } = descriptor.archiveSchema.parse(input) as {
      id: string;
      archived: boolean;
    };

    const before = await requireRow(id);
    // Already in the requested state: return without writing, so a double-click
    // can't put a meaningless "archived → archived" entry in the audit log.
    if (before.archived === archived) return before;

    const row = await repository.update(id, { archived });
    if (!row) throw new NotFoundError(descriptor.label, id);

    await audit(
      archived ? "archived" : "unarchived",
      row.id,
      { archived: before.archived },
      { archived: row.archived },
    );
    invalidate(row.id);
    return row;
  }

  async function remove(input: unknown): Promise<void> {
    await permit("delete");
    const { id } = descriptor.idSchema.parse(input) as { id: string };

    const before = await requireRow(id);
    await rules.beforeDelete?.(before);

    await repository.remove(id);
    // Audit the whole row: after this, `before` is the only record it existed.
    await audit("deleted", id, snapshot(before), null);
    invalidate(id);
  }

  return { list, findById, stats, create, update, archive, remove };
}

/**
 * An omitted optional field means "clear it", which in SQL is `NULL` — not the
 * `undefined` that Drizzle would skip, leaving the old value in place.
 */
function withNulls(values: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    next[key] = value === undefined ? null : value;
  }
  return next;
}
