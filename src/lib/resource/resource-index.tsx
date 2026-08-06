"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
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
import type { PermissionKey } from "@/lib/permissions";
import type { TableParams } from "@/lib/table-params";
import { useHasPermissionKey } from "@/modules/rbac/permission-provider";

import { resourceMutate } from "./actions";
import type { ResourceDescriptor, ResourceRecord } from "./define";
import { getResource } from "./registry";
import { ResourceFormDialog } from "./resource-form-dialog";

/**
 * The index screen every resource gets: header, toolbar, table, row actions and
 * the create/edit dialog.
 *
 * The descriptor is looked up here rather than passed in, because it carries
 * zod schemas and formatter functions — none of which survive serialization
 * across the RSC boundary. The Server Component sends the resource's *name*;
 * this Client Component resolves it against the same isomorphic registry the
 * server used.
 */
export function ResourceIndex({
  resource,
  records,
  totalRows,
  totalRowsCapped,
  params,
}: {
  resource: string;
  records: ResourceRecord[];
  totalRows: number;
  totalRowsCapped: boolean;
  params: TableParams;
}) {
  const descriptor = getResource(resource);
  const router = useRouter();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ResourceRecord | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Called unconditionally and in a fixed order — a resource that isn't
  // archivable still evaluates its `archive` key, and simply never holds it.
  const canCreate = useHasPermissionKey(permission(descriptor, "create"));
  const canUpdate = useHasPermissionKey(permission(descriptor, "update"));
  const canDelete = useHasPermissionKey(permission(descriptor, "delete"));
  const canArchive =
    useHasPermissionKey(permission(descriptor, "archive")) &&
    descriptor.archivable;
  const hasRowActions = canUpdate || canArchive || canDelete;

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(record: ResourceRecord) {
    setEditing(record);
    setDialogOpen(true);
  }

  const title = (record: ResourceRecord) =>
    formatField(descriptor, descriptor.primaryField, record);

  /** What the user must type to confirm a delete — the most identifying value. */
  const confirmPhrase = (record: ResourceRecord) =>
    descriptor.secondaryField
      ? formatField(descriptor, descriptor.secondaryField, record)
      : title(record);

  async function toggleArchived(record: ResourceRecord) {
    // Disable this row's controls while the action is in flight, so a second
    // click can't queue a contradictory write.
    setPendingId(record.id);
    const result = await resourceMutate(descriptor.name, "archive", {
      id: record.id,
      archived: !record.archived,
    });
    setPendingId(null);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(
      result.data.archived
        ? `"${title(record)}" archived.`
        : `"${title(record)}" restored.`,
    );
    // The server re-renders the page with fresh rows; nothing is mutated
    // locally, so the table can't drift from the database.
    router.refresh();
  }

  async function remove(record: ResourceRecord) {
    const result = await resourceMutate(descriptor.name, "delete", {
      id: record.id,
    });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`${descriptor.label} "${confirmPhrase(record)}" deleted.`);
    router.refresh();
  }

  function RowActions({ record }: { record: ResourceRecord }) {
    return (
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${title(record)}`}
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-48">
            {canUpdate ? (
              <DropdownMenuItem onSelect={() => openEdit(record)}>
                <Pencil className="size-4" aria-hidden />
                Edit details
              </DropdownMenuItem>
            ) : null}

            {canArchive ? (
              <DropdownMenuItem
                disabled={pendingId === record.id}
                onSelect={() => void toggleArchived(record)}
              >
                {record.archived ? (
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
                    title={`Delete ${title(record)}?`}
                    description={
                      <p>
                        This permanently removes the{" "}
                        {descriptor.label.toLowerCase()}.
                        {descriptor.archivable
                          ? " Archiving keeps it out of the list without losing its history — prefer that unless the row was created by mistake."
                          : " This cannot be undone."}
                      </p>
                    }
                    confirmLabel={`Delete ${descriptor.label.toLowerCase()}`}
                    destructive
                    confirmPhrase={confirmPhrase(record)}
                    onConfirm={() => remove(record)}
                  />
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  const columns = buildColumns(descriptor, {
    renderPrimary: (record) => (
      <PrimaryCell descriptor={descriptor} record={record} />
    ),
    renderActions: hasRowActions
      ? (record) => <RowActions record={record} />
      : null,
  });

  return (
    <>
      <PageHeader
        title={descriptor.pluralLabel}
        description={descriptor.description}
        actions={
          canCreate ? (
            <Button type="button" onClick={openCreate}>
              <Plus className="size-4" aria-hidden />
              New {descriptor.label.toLowerCase()}
            </Button>
          ) : null
        }
      />

      <DataTable
        columns={columns}
        data={records}
        totalRows={totalRows}
        totalRowsCapped={totalRowsCapped}
        params={params}
        getRowId={(record) => record.id}
        emptyTitle={descriptor.emptyTitle}
        emptyDescription={descriptor.emptyDescription}
        emptyAction={
          canCreate ? (
            <Button type="button" onClick={openCreate}>
              <descriptor.icon className="size-4" aria-hidden />
              Add a {descriptor.label.toLowerCase()}
            </Button>
          ) : null
        }
        toolbar={
          <TableToolbar
            searchPlaceholder={descriptor.searchPlaceholder}
            filters={descriptor.filters}
          />
        }
        renderMobileCard={(record) => (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <PrimaryCell descriptor={descriptor} record={record} />
              {hasRowActions ? <RowActions record={record} /> : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {descriptor.fieldEntries
                .filter(
                  ([name, field]) =>
                    field.inTable &&
                    field.kind !== "textarea" &&
                    name !== descriptor.primaryField &&
                    name !== descriptor.secondaryField,
                )
                .map(([name, field]) => (
                  <span
                    key={name}
                    className={
                      field.numeric
                        ? "font-mono text-sm tabular-nums"
                        : "text-sm text-muted-foreground"
                    }
                  >
                    {field.format(record[name])}
                  </span>
                ))}
              {descriptor.archivable ? (
                <StatusBadge archived={Boolean(record.archived)} />
              ) : null}
            </div>

            {descriptor.fieldEntries
              .filter(([, field]) => field.kind === "textarea")
              .map(([name]) =>
                record[name] ? (
                  <p
                    key={name}
                    className="line-clamp-2 text-sm text-muted-foreground"
                  >
                    {String(record[name])}
                  </p>
                ) : null,
              )}
          </div>
        )}
      />

      <ResourceFormDialog
        descriptor={descriptor}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        record={editing}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function buildColumns(
  descriptor: ResourceDescriptor,
  render: {
    renderPrimary: (record: ResourceRecord) => React.ReactNode;
    renderActions: ((record: ResourceRecord) => React.ReactNode) | null;
  },
): DataTableColumn<ResourceRecord>[] {
  const primary = descriptor.fields[descriptor.primaryField]!;

  const columns: DataTableColumn<ResourceRecord>[] = [
    {
      id: descriptor.primaryField,
      header: descriptor.secondaryField ? descriptor.label : primary.label,
      sortKey: primary.sortable ? descriptor.primaryField : undefined,
      cell: ({ row }) => render.renderPrimary(row.original),
    },
  ];

  for (const [name, field] of descriptor.fieldEntries) {
    if (!field.inTable) continue;
    if (name === descriptor.primaryField) continue;
    // The secondary field is already rendered under the headline.
    if (name === descriptor.secondaryField) continue;

    columns.push({
      id: name,
      header: field.label,
      sortKey: field.sortable ? name : undefined,
      cell: ({ row }) => (
        <span
          className={
            field.numeric
              ? "font-mono text-sm whitespace-nowrap tabular-nums"
              : "text-sm"
          }
        >
          {field.format(row.original[name])}
        </span>
      ),
    });
  }

  if (descriptor.archivable) {
    columns.push({
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge archived={Boolean(row.original.archived)} />
      ),
    });
  }

  columns.push({
    id: "createdAt",
    header: "Added",
    sortKey: "createdAt",
    cell: ({ row }) => {
      const value = row.original.createdAt;
      if (typeof value !== "string") return null;
      return (
        <time
          dateTime={value}
          className="text-sm whitespace-nowrap text-muted-foreground"
        >
          {/*
            Fixed locale: this renders on the server first, where `undefined`
            resolves to the server's locale rather than the viewer's, and the
            two disagreeing is a hydration mismatch.
          */}
          {new Date(value).toLocaleDateString("en-US")}
        </time>
      );
    },
  });

  if (render.renderActions) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => render.renderActions!(row.original),
    });
  }

  return columns;
}

function PrimaryCell({
  descriptor,
  record,
}: {
  descriptor: ResourceDescriptor;
  record: ResourceRecord;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">
        {formatField(descriptor, descriptor.primaryField, record)}
      </p>
      {descriptor.secondaryField ? (
        <p className="truncate font-mono text-xs text-muted-foreground">
          {formatField(descriptor, descriptor.secondaryField, record)}
        </p>
      ) : null}
    </div>
  );
}

function StatusBadge({ archived }: { archived: boolean }) {
  return archived ? (
    <Badge variant="secondary">archived</Badge>
  ) : (
    <Badge variant="outline">active</Badge>
  );
}

function permission(
  descriptor: ResourceDescriptor,
  action: string,
): PermissionKey {
  return `${descriptor.name}:${action}` as PermissionKey;
}

function formatField(
  descriptor: ResourceDescriptor,
  name: string,
  record: ResourceRecord,
): string {
  const field = descriptor.fields[name];
  return field ? field.format(record[name]) : String(record[name] ?? "");
}
