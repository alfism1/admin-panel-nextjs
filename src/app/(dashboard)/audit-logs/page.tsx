import type { Metadata } from "next";

import { Forbidden } from "@/components/shared/forbidden";
import { parseTableParams } from "@/lib/table-params";
import { AuditLogsView } from "@/modules/audit-log/components/audit-logs-view";
import { auditLogService } from "@/modules/audit-log/audit-log.service";
import { hasPermission } from "@/modules/rbac/permissions.service";

export const metadata: Metadata = { title: "Audit logs" };

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await hasPermission("auditLog", "read"))) {
    return <Forbidden />;
  }

  const params = parseTableParams(await searchParams);

  const [{ rows, total }, filterOptions] = await Promise.all([
    auditLogService.list({
      page: params.page,
      pageSize: params.pageSize,
      sort: params.sort ?? "createdAt",
      order: params.order,
      search: params.search,
      action: params.filters.action,
      resourceType: params.filters.resourceType,
      actorId: params.filters.actorId,
      from: params.filters.from,
      to: params.filters.to,
    }),
    auditLogService.getFilterOptions(),
  ]);

  return (
    <AuditLogsView
      entries={rows.map((entry) => ({
        id: entry.id,
        actorId: entry.actorId,
        actorEmail: entry.actorEmail,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        before: entry.before,
        after: entry.after,
        ip: entry.ip,
        userAgent: entry.userAgent,
        createdAt: entry.createdAt.toISOString(),
      }))}
      totalRows={total}
      params={params}
      actions={filterOptions.actions}
      actors={filterOptions.actors}
    />
  );
}
