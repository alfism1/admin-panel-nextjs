import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/db/client";
import { newId } from "@/db/id";
import { auditLogs, type AuditLogRow, type NewAuditLogRow } from "@/db/schema";

import type { ListAuditLogsInput } from "./audit-log.schema";

/**
 * Audit log data access.
 *
 * This is the one place in the app allowed to build dialect-specific SQL:
 * `ilike` is Postgres. Ported to MySQL it becomes a `LIKE` on a
 * case-insensitive collation, to SQLite a `LIKE` (already case-insensitive for
 * ASCII). Isolating it here is what keeps the schema swappable.
 */

export type AuditLogFilters = Omit<ListAuditLogsInput, "page" | "pageSize">;

function buildWhere(filters: Partial<AuditLogFilters>): SQL | undefined {
  const clauses: SQL[] = [];

  if (filters.actorId) {
    clauses.push(eq(auditLogs.actorId, filters.actorId));
  }
  if (filters.action) {
    clauses.push(eq(auditLogs.action, filters.action));
  }
  if (filters.resourceType) {
    clauses.push(eq(auditLogs.resourceType, filters.resourceType));
  }

  if (filters.from) {
    const from = new Date(`${filters.from}T00:00:00.000Z`);
    if (!Number.isNaN(from.getTime())) {
      clauses.push(gte(auditLogs.createdAt, from));
    }
  }
  if (filters.to) {
    // The picker gives a date, the user means "up to the end of that day".
    const to = new Date(`${filters.to}T00:00:00.000Z`);
    if (!Number.isNaN(to.getTime())) {
      to.setUTCDate(to.getUTCDate() + 1);
      clauses.push(lt(auditLogs.createdAt, to));
    }
  }

  const search = filters.search?.trim();
  if (search) {
    // Escape LIKE wildcards so a literal `%` doesn't match everything.
    const pattern = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const searchClause = or(
      ilike(auditLogs.actorEmail, pattern),
      ilike(auditLogs.resourceId, pattern),
      ilike(auditLogs.action, pattern),
    );
    if (searchClause) clauses.push(searchClause);
  }

  if (clauses.length === 0) return undefined;
  return and(...clauses);
}

const SORT_COLUMNS = {
  createdAt: auditLogs.createdAt,
  action: auditLogs.action,
  actorEmail: auditLogs.actorEmail,
} as const;

async function list(
  input: ListAuditLogsInput,
): Promise<{ rows: AuditLogRow[]; total: number }> {
  const where = buildWhere(input);
  const column = SORT_COLUMNS[input.sort];
  const orderBy = input.order === "asc" ? asc(column) : desc(column);

  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(orderBy)
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db.select({ value: count() }).from(auditLogs).where(where),
  ]);

  return { rows, total: totals?.value ?? 0 };
}

/**
 * Streams matching rows in batches for CSV export.
 *
 * A `SELECT *` over an unbounded audit table is how an export takes the process
 * down with it; keyset pagination over `created_at` keeps memory flat and lets
 * the response start before the query has finished.
 */
async function* streamForExport(
  filters: Partial<AuditLogFilters>,
  batchSize = 500,
  hardLimit = 100_000,
): AsyncGenerator<AuditLogRow[]> {
  const where = buildWhere(filters);
  let offset = 0;

  while (offset < hardLimit) {
    const batch = await db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(batchSize)
      .offset(offset);

    if (batch.length === 0) return;
    yield batch;
    if (batch.length < batchSize) return;
    offset += batchSize;
  }
}

async function findById(id: string): Promise<AuditLogRow | null> {
  const [row] = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.id, id))
    .limit(1);
  return row ?? null;
}

async function insert(
  values: Omit<NewAuditLogRow, "id" | "createdAt">,
): Promise<AuditLogRow> {
  const [row] = await db
    .insert(auditLogs)
    .values({ id: newId(), ...values })
    .returning();
  if (!row) throw new Error("Insert into audit_logs returned no row.");
  return row;
}

async function listRecent(limit: number): Promise<AuditLogRow[]> {
  return db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

async function distinctActions(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ action: auditLogs.action })
    .from(auditLogs)
    .orderBy(asc(auditLogs.action));
  return rows.map((row) => row.action);
}

async function stats(): Promise<{ total: number; last24Hours: number }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [[total], [recent]] = await Promise.all([
    db.select({ value: count() }).from(auditLogs),
    db
      .select({ value: count() })
      .from(auditLogs)
      .where(gte(auditLogs.createdAt, since)),
  ]);
  return { total: total?.value ?? 0, last24Hours: recent?.value ?? 0 };
}

/** Deletes entries older than `before`. Returns how many went. */
async function deleteOlderThan(before: Date): Promise<number> {
  const deleted = await db
    .delete(auditLogs)
    .where(lte(auditLogs.createdAt, before))
    .returning({ id: auditLogs.id });
  return deleted.length;
}

async function countOlderThan(before: Date): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(auditLogs)
    .where(lte(auditLogs.createdAt, before));
  return row?.value ?? 0;
}

/** Actors seen in the log, for the filter dropdown. */
async function distinctActors(): Promise<
  { actorId: string; actorEmail: string }[]
> {
  const rows = await db
    .selectDistinct({
      actorId: auditLogs.actorId,
      actorEmail: auditLogs.actorEmail,
    })
    .from(auditLogs)
    .where(sql`${auditLogs.actorId} is not null`)
    .orderBy(asc(auditLogs.actorEmail))
    .limit(200);

  return rows.flatMap((row) =>
    row.actorId
      ? [{ actorId: row.actorId, actorEmail: row.actorEmail ?? row.actorId }]
      : [],
  );
}

export const auditLogRepository = {
  list,
  listRecent,
  findById,
  insert,
  streamForExport,
  distinctActions,
  distinctActors,
  stats,
  deleteOlderThan,
  countOlderThan,
};
