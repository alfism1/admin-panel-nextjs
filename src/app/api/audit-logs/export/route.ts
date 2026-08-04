import { withApiHandler } from "@/lib/api";
import { auditLogService } from "@/modules/audit-log/audit-log.service";
import { exportAuditLogsSchema } from "@/modules/audit-log/audit-log.schema";

/**
 * CSV export, gated behind `auditLog:export` — a strictly higher bar than
 * `auditLog:read`, because an export leaves the system and stops being subject
 * to its access controls.
 *
 * The response is streamed; see `auditLogService.exportCsv` for why.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiHandler("auditLog", "export", async (request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filters = exportAuditLogsSchema.parse(params);

  const stream = await auditLogService.exportCsv(filters);
  const filename = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
