import "server-only";

import { headers } from "next/headers";

import type { AuditLogRow } from "@/db/schema";
import { env } from "@/lib/env";
import { getLogger } from "@/lib/logger";
import { requirePermission } from "@/modules/rbac/permissions.service";
import { getSession } from "@/modules/rbac/session";

import { auditLogRepository } from "./audit-log.repository";
import {
  listAuditLogsSchema,
  type AuditAction,
  type AuditResourceType,
  type ExportAuditLogsInput,
  type ListAuditLogsInput,
} from "./audit-log.schema";

/**
 * The audit trail.
 *
 * `logAudit()` is called from the **service layer** of every mutating module,
 * never from a Route Handler or Server Action. That placement is the whole
 * point: a new transport (a REST endpoint, a CLI, a background job) reusing an
 * existing service gets auditing for free and cannot forget it.
 */

export interface LogAuditInput {
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Overrides the ambient session actor — used by hooks and system jobs. */
  actor?: { id: string | null; email: string | null };
}

/**
 * Writes one audit entry.
 *
 * Never throws. An audit write failing must not roll back the business action
 * that succeeded — losing the record is bad, but silently reverting a
 * completed ban is worse, and the failure is logged at `error` for alerting.
 */
export async function logAudit(input: LogAuditInput): Promise<void> {
  const log = getLogger({ scope: "audit" });

  try {
    const actor = input.actor ?? (await resolveAmbientActor());
    const request = await resolveRequestContext();

    await auditLogRepository.insert({
      actorId: actor.id,
      actorEmail: actor.email,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      ip: request.ip,
      userAgent: request.userAgent,
    });

    log.debug(
      {
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        actorId: actor.id,
      },
      "audit entry written",
    );
  } catch (error) {
    log.error(
      { err: error, action: input.action },
      "failed to write audit entry",
    );
  }
}

async function resolveAmbientActor(): Promise<{
  id: string | null;
  email: string | null;
}> {
  try {
    const session = await getSession();
    return session
      ? { id: session.user.id, email: session.user.email }
      : { id: null, email: null };
  } catch {
    // Outside a request scope (seed, cron) there is no session to read.
    return { id: null, email: null };
  }
}

async function resolveRequestContext(): Promise<{
  ip: string | null;
  userAgent: string | null;
}> {
  try {
    const headerList = await headers();
    // Behind a proxy the client is the *first* entry; the rest are hops.
    const forwardedFor = headerList.get("x-forwarded-for");
    const ip =
      headerList.get("cf-connecting-ip") ??
      headerList.get("x-real-ip") ??
      forwardedFor?.split(",")[0]?.trim() ??
      null;

    return { ip, userAgent: headerList.get("user-agent") };
  } catch {
    return { ip: null, userAgent: null };
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function list(
  input: unknown,
): Promise<{ rows: AuditLogRow[]; total: number }> {
  await requirePermission("auditLog", "read");
  const parsed = listAuditLogsSchema.parse(input);
  return auditLogRepository.list(parsed);
}

async function findById(id: string): Promise<AuditLogRow | null> {
  await requirePermission("auditLog", "read");
  return auditLogRepository.findById(id);
}

/** Recent entries for the dashboard card. Read permission still required. */
async function listForDashboard(limit = 6): Promise<{ rows: AuditLogRow[] }> {
  const authorization = await requirePermission("auditLog", "read");
  void authorization;
  return { rows: await auditLogRepository.listRecent(limit) };
}

async function getStats(): Promise<{ total: number; last24Hours: number }> {
  return auditLogRepository.stats();
}

async function getFilterOptions(): Promise<{
  actions: string[];
  actors: { actorId: string; actorEmail: string }[];
}> {
  await requirePermission("auditLog", "read");
  const [actions, actors] = await Promise.all([
    auditLogRepository.distinctActions(),
    auditLogRepository.distinctActors(),
  ]);
  return { actions, actors };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const CSV_COLUMNS = [
  "id",
  "created_at",
  "actor_id",
  "actor_email",
  "action",
  "resource_type",
  "resource_id",
  "ip",
  "user_agent",
  "before",
  "after",
] as const;

/**
 * CSV export as a `ReadableStream`, gated behind `auditLog:export`.
 *
 * Streamed rather than buffered: exporting six months of an active panel is
 * hundreds of megabytes of JSON snapshots, and building that string in memory
 * first is a reliable way to OOM a container.
 */
async function exportCsv(
  input: ExportAuditLogsInput,
): Promise<ReadableStream<Uint8Array>> {
  await requirePermission("auditLog", "export");

  await logAudit({
    action: "auditLog.exported",
    resourceType: "auditLog",
    after: { filters: input },
  });

  const encoder = new TextEncoder();
  const batches = auditLogRepository.streamForExport(input);

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`${CSV_COLUMNS.join(",")}\n`));
    },
    async pull(controller) {
      const next = await batches.next();
      if (next.done) {
        controller.close();
        return;
      }
      const chunk = next.value.map(toCsvRow).join("");
      controller.enqueue(encoder.encode(chunk));
    },
    cancel() {
      void batches.return(undefined);
    },
  });
}

function toCsvRow(row: AuditLogRow): string {
  return (
    [
      row.id,
      row.createdAt.toISOString(),
      row.actorId ?? "",
      row.actorEmail ?? "",
      row.action,
      row.resourceType,
      row.resourceId ?? "",
      row.ip ?? "",
      row.userAgent ?? "",
      row.before ? JSON.stringify(row.before) : "",
      row.after ? JSON.stringify(row.after) : "",
    ]
      .map(csvEscape)
      .join(",") + "\n"
  );
}

/**
 * RFC 4180 quoting, plus a leading apostrophe on anything a spreadsheet would
 * treat as a formula. Without it, a user agent of `=cmd|'/c calc'!A1` becomes
 * CSV injection the moment someone opens the export in Excel.
 */
function csvEscape(value: string): string {
  const dangerous = /^[=+\-@\t\r]/.test(value);
  const escaped = (dangerous ? `'${value}` : value).replace(/"/g, '""');
  return `"${escaped}"`;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Deletes entries past `AUDIT_LOG_RETENTION_DAYS`.
 *
 * Not scheduled by the app — Next.js has no scheduler, and a `setInterval` in a
 * serverless process is a bug. Call it from a cron trigger, a queue worker, or
 * `POST /api/audit-logs/purge`. See the README for wiring examples.
 */
async function purgeExpired(options: { dryRun?: boolean } = {}): Promise<{
  cutoff: Date;
  deleted: number;
  dryRun: boolean;
}> {
  const cutoff = new Date(
    Date.now() - env.AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  if (options.dryRun) {
    return {
      cutoff,
      deleted: await auditLogRepository.countOlderThan(cutoff),
      dryRun: true,
    };
  }

  const deleted = await auditLogRepository.deleteOlderThan(cutoff);

  if (deleted > 0) {
    await logAudit({
      action: "auditLog.purged",
      resourceType: "auditLog",
      after: {
        cutoff: cutoff.toISOString(),
        deleted,
        retentionDays: env.AUDIT_LOG_RETENTION_DAYS,
      },
      actor: { id: null, email: null },
    });
  }

  getLogger({ scope: "audit" }).info(
    { cutoff: cutoff.toISOString(), deleted },
    "purged expired audit log entries",
  );

  return { cutoff, deleted, dryRun: false };
}

export const auditLogService = {
  logAudit,
  list,
  listForDashboard,
  findById,
  getStats,
  getFilterOptions,
  exportCsv,
  purgeExpired,
};

export type { ListAuditLogsInput };
