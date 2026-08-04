"use client";

import { useState } from "react";
import { Download, Eye } from "lucide-react";

import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { TableToolbar } from "@/components/shared/table-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useTableParams } from "@/hooks/use-table-params";
import type { TableParams } from "@/lib/table-params";
import { usePermission } from "@/modules/rbac/permission-provider";

import { DiffView } from "./diff-view";

export interface AuditLogRowView {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export function AuditLogsView({
  entries,
  totalRows,
  params,
  actions,
  actors,
}: {
  entries: AuditLogRowView[];
  totalRows: number;
  params: TableParams;
  actions: string[];
  actors: { actorId: string; actorEmail: string }[];
}) {
  const [selected, setSelected] = useState<AuditLogRowView | null>(null);
  const canExport = usePermission("auditLog", "export");

  const columns: DataTableColumn<AuditLogRowView>[] = [
    {
      id: "createdAt",
      header: "When",
      sortKey: "createdAt",
      cell: ({ row }) => (
        <time
          dateTime={row.original.createdAt}
          className="text-sm whitespace-nowrap text-muted-foreground"
        >
          {new Date(row.original.createdAt).toLocaleString()}
        </time>
      ),
    },
    {
      id: "actor",
      header: "Actor",
      sortKey: "actorEmail",
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.actorEmail ?? (
            <span className="text-muted-foreground italic">system</span>
          )}
        </span>
      ),
    },
    {
      id: "action",
      header: "Action",
      sortKey: "action",
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono text-xs">
          {row.original.action}
        </Badge>
      ),
    },
    {
      id: "resource",
      header: "Resource",
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.resourceType}
          {row.original.resourceId ? (
            <span className="text-muted-foreground">
              {" "}
              · {truncate(row.original.resourceId)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "view",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelected(row.original)}
          >
            <Eye className="size-4" aria-hidden />
            <span className="sr-only sm:not-sr-only">Details</span>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit logs"
        description="Append-only record of every mutation. Written at the service layer, so nothing that changes state can skip it."
        actions={canExport ? <ExportButton /> : null}
      />

      <DataTable
        columns={columns}
        data={entries}
        totalRows={totalRows}
        params={params}
        getRowId={(entry) => entry.id}
        emptyTitle="No audit entries"
        emptyDescription="Entries appear here as soon as anything is created, changed or deleted."
        toolbar={
          <div className="space-y-2">
            <TableToolbar
              searchPlaceholder="Search actor, action or resource id…"
              filters={[
                {
                  name: "action",
                  label: "Action",
                  options: actions.map((action) => ({
                    value: action,
                    label: action,
                  })),
                },
                {
                  name: "resourceType",
                  label: "Resource",
                  options: [
                    { value: "user", label: "User" },
                    { value: "role", label: "Role" },
                    { value: "featureFlag", label: "Feature flag" },
                    { value: "session", label: "Session" },
                    { value: "auditLog", label: "Audit log" },
                    { value: "system", label: "System" },
                  ],
                },
                {
                  name: "actorId",
                  label: "Actor",
                  options: actors.map((actor) => ({
                    value: actor.actorId,
                    label: actor.actorEmail,
                  })),
                },
              ]}
            />
            <DateRangeFilter />
          </div>
        }
        renderMobileCard={(entry) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <Badge variant="outline" className="font-mono text-xs">
                {entry.action}
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelected(entry)}
              >
                <Eye className="size-4" aria-hidden />
                <span className="sr-only">View details</span>
              </Button>
            </div>
            <p className="text-sm">
              {entry.actorEmail ?? "system"}
              <span className="text-muted-foreground">
                {" "}
                · {entry.resourceType}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              <time dateTime={entry.createdAt}>
                {new Date(entry.createdAt).toLocaleString()}
              </time>
            </p>
          </div>
        )}
      />

      <DetailSheet entry={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function ExportButton() {
  const { params } = useTableParams();

  // A plain link, not a fetch: the route streams a CSV, and letting the browser
  // handle the download avoids buffering the whole file in memory first.
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  for (const [key, value] of Object.entries(params.filters)) {
    query.set(key, value);
  }

  return (
    <Button asChild variant="outline">
      <a href={`/api/audit-logs/export?${query.toString()}`} download>
        <Download className="size-4" aria-hidden />
        Export CSV
      </a>
    </Button>
  );
}

function DateRangeFilter() {
  const { params, update } = useTableParams();

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="grid gap-1">
        <Label htmlFor="audit-from" className="text-xs text-muted-foreground">
          From
        </Label>
        <Input
          id="audit-from"
          type="date"
          className="h-9 w-[10rem]"
          value={params.filters.from ?? ""}
          onChange={(event) => update({ from: event.target.value || null })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="audit-to" className="text-xs text-muted-foreground">
          To
        </Label>
        <Input
          id="audit-to"
          type="date"
          className="h-9 w-[10rem]"
          value={params.filters.to ?? ""}
          onChange={(event) => update({ to: event.target.value || null })}
        />
      </div>
    </div>
  );
}

function DetailSheet({
  entry,
  onClose,
}: {
  entry: AuditLogRowView | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {entry ? (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono text-base">
                {entry.action}
              </SheetTitle>
              <SheetDescription>
                <time dateTime={entry.createdAt}>
                  {new Date(entry.createdAt).toLocaleString()}
                </time>
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 px-4 pb-6">
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <Detail label="Actor" value={entry.actorEmail ?? "system"} />
                <Detail label="Actor id" value={entry.actorId ?? "—"} mono />
                <Detail label="Resource" value={entry.resourceType} />
                <Detail
                  label="Resource id"
                  value={entry.resourceId ?? "—"}
                  mono
                />
                <Detail label="IP" value={entry.ip ?? "—"} mono />
                <Detail label="User agent" value={entry.userAgent ?? "—"} />
              </dl>

              <div className="space-y-2">
                <h3 className="text-sm font-medium">What changed</h3>
                <DiffView before={entry.before} after={entry.after} />
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`break-words ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function truncate(value: string, length = 12): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}
