"use client";

import { useEffect, useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type RowSelectionState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Inbox,
  Loader2,
  SearchX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useTableParams } from "@/hooks/use-table-params";
import { PAGE_SIZE_OPTIONS, type TableParams } from "@/lib/table-params";

import { EmptyState } from "./empty-state";

/**
 * The admin panel's table.
 *
 * Server-driven by design: sorting, filtering and paging are URL state that a
 * Server Component reads and turns into a `LIMIT`/`OFFSET` query. The client
 * never receives more rows than it displays, so a table over 200k users costs
 * the same as one over 20.
 *
 * Below `md` the `<table>` is replaced by a card list. This is a real layout
 * swap, not `overflow-x: auto` — horizontally scrolling a table on a phone
 * hides the columns that matter and is the fastest way to make an admin panel
 * unusable on a 375px screen.
 */

/**
 * `ColumnDef` is a union (accessor / display / grouping), so this has to be an
 * intersection — an interface cannot extend a union.
 */
export type DataTableColumn<TData> = ColumnDef<TData, unknown> & {
  /** Column id to sort by. Absent ⇒ the header isn't a sort button. */
  sortKey?: string;
};

export interface DataTableProps<TData> {
  columns: DataTableColumn<TData>[];
  data: TData[];
  /** Row count across *all* pages, from the server. Drives the pager. */
  totalRows: number;
  /**
   * `totalRows` is a floor rather than the real count — the server stopped
   * counting. Renders as "5,000+" and keeps the last page reachable, because
   * the true page count is unknown and `Math.ceil` would invent one.
   */
  totalRowsCapped?: boolean;
  params: TableParams;
  getRowId: (row: TData) => string;
  /** Rendered above the table: search box, filter selects, etc. */
  toolbar?: React.ReactNode;
  /** Rendered when rows are selected. Receives the selected ids. */
  bulkActions?: (selectedIds: string[], clear: () => void) => React.ReactNode;
  /** Card body for `< md`. Falls back to stacking every visible column. */
  renderMobileCard?: (row: TData) => React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  isLoading?: boolean;
}

export function DataTable<TData>({
  columns,
  data,
  totalRows,
  totalRowsCapped = false,
  params,
  getRowId,
  toolbar,
  bulkActions,
  renderMobileCard,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyAction,
  isLoading = false,
}: DataTableProps<TData>) {
  const { update, toggleSort, reset, isPending } = useTableParams();
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const selectable = Boolean(bulkActions);

  const tableColumns = useMemo<DataTableColumn<TData>[]>(() => {
    if (!selectable) return columns;
    return [selectionColumn<TData>(), ...columns];
  }, [columns, selectable]);

  /**
   * The React Compiler skips memoizing this component because `useReactTable`
   * returns fresh function identities each render. That is inherent to the
   * library and safe here: the table is a pure renderer over server-supplied
   * rows, so there is nothing expensive to memoize.
   */
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
    enableRowSelection: selectable,
    // Everything happens on the server; the table is a renderer, not an engine.
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });

  const selectedIds = Object.keys(rowSelection).filter(
    (id) => rowSelection[id],
  );

  // Selections refer to ids that no longer exist once the page changes.
  useEffect(() => {
    setRowSelection({});
  }, [params.page, params.pageSize, params.search, params.sort, params.order]);

  const pageCount = Math.max(1, Math.ceil(totalRows / params.pageSize));
  const firstRow =
    totalRows === 0 ? 0 : (params.page - 1) * params.pageSize + 1;
  const lastRow = Math.min(params.page * params.pageSize, totalRows);
  // Capped totals make the computed last page a lie, so Next stays enabled and
  // a full page of rows is the signal that there is more.
  const hasNextPage = totalRowsCapped
    ? data.length === params.pageSize
    : params.page < pageCount;
  const totalLabel = `${totalRows.toLocaleString()}${totalRowsCapped ? "+" : ""}`;
  const isFiltered =
    params.search.trim() !== "" || Object.keys(params.filters).length > 0;

  const busy = isLoading || isPending;

  return (
    <div className="space-y-4">
      {toolbar ? <div className="min-w-0">{toolbar}</div> : null}

      {selectable && selectedIds.length > 0 ? (
        <div
          role="region"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2"
        >
          <span className="text-sm font-medium">
            {selectedIds.length} selected
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {bulkActions?.(selectedIds, () => setRowSelection({}))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRowSelection({})}
            >
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      {busy ? (
        <TableSkeleton rows={Math.min(params.pageSize, 8)} />
      ) : data.length === 0 ? (
        isFiltered ? (
          <EmptyState
            icon={SearchX}
            title="No matches"
            description="No rows match the current search and filters."
            action={
              <Button type="button" variant="outline" onClick={reset}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title={emptyTitle}
            description={emptyDescription}
            action={emptyAction}
          />
        )
      ) : (
        <>
          {/* ---------- Desktop: real table ---------- */}
          <div className="hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const column = header.column
                        .columnDef as DataTableColumn<TData>;
                      const sortKey = column.sortKey;
                      const isSorted = sortKey && params.sort === sortKey;

                      return (
                        <TableHead
                          key={header.id}
                          aria-sort={
                            isSorted
                              ? params.order === "asc"
                                ? "ascending"
                                : "descending"
                              : sortKey
                                ? "none"
                                : undefined
                          }
                        >
                          {header.isPlaceholder ? null : sortKey ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="-ml-2 h-8 data-[active=true]:text-foreground"
                              data-active={isSorted}
                              onClick={() => toggleSort(sortKey)}
                            >
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                              <SortIcon
                                active={Boolean(isSorted)}
                                order={params.order}
                              />
                            </Button>
                          ) : (
                            flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>

              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* ---------- Mobile: card list ---------- */}
          {/*
            `min-w-0` on both the list and each card is load-bearing: a grid
            item defaults to `min-width: auto`, which refuses to shrink below
            its longest unbreakable content. One long e-mail address is then
            enough to push the whole page wider than a 375px viewport.
          */}
          <ul className="grid min-w-0 gap-3 md:hidden">
            {table.getRowModel().rows.map((row) => (
              <li key={row.id} className="min-w-0 rounded-lg border p-4">
                {selectable ? (
                  <div className="mb-3 flex items-center gap-2">
                    <Checkbox
                      checked={row.getIsSelected()}
                      onCheckedChange={(checked) =>
                        row.toggleSelected(Boolean(checked))
                      }
                      aria-label="Select row"
                    />
                    <span className="text-xs text-muted-foreground">
                      Select
                    </span>
                  </div>
                ) : null}
                {renderMobileCard
                  ? renderMobileCard(row.original)
                  : defaultMobileCard(row)}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ---------- Pager ---------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p
          className="text-sm text-muted-foreground"
          aria-live="polite"
          aria-atomic="true"
        >
          {totalRows === 0
            ? "No results"
            : `${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${totalLabel}`}
        </p>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <div className="flex items-center gap-2">
            <label
              htmlFor="page-size"
              className="hidden text-sm text-muted-foreground sm:inline"
            >
              Rows
            </label>
            <Select
              value={String(params.pageSize)}
              onValueChange={(value) => update({ pageSize: value, page: 1 })}
            >
              <SelectTrigger id="page-size" size="sm" className="w-[4.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={params.page <= 1 || busy}
              onClick={() => update({ page: params.page - 1 })}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <span className="px-2 text-sm tabular-nums">
              {params.page} / {totalRowsCapped ? "…" : pageCount}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={!hasNextPage || busy}
              onClick={() => update({ page: params.page + 1 })}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SortIcon({
  active,
  order,
}: {
  active: boolean;
  order: "asc" | "desc";
}) {
  if (!active) {
    return (
      <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden />
    );
  }
  return order === "asc" ? (
    <ArrowUp className="size-3.5" aria-hidden />
  ) : (
    <ArrowDown className="size-3.5" aria-hidden />
  );
}

function selectionColumn<TData>(): ColumnDef<TData, unknown> {
  return {
    id: "__select__",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(checked) =>
          table.toggleAllPageRowsSelected(Boolean(checked))
        }
        aria-label="Select all rows on this page"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
  };
}

/** Stacks every non-selection cell as a label/value pair. */
function defaultMobileCard<TData>(row: Row<TData>) {
  return (
    <dl className="grid gap-2 text-sm">
      {row
        .getVisibleCells()
        .filter((cell) => cell.column.id !== "__select__")
        .map((cell) => (
          <div key={cell.id} className="flex items-start justify-between gap-3">
            <dt className="shrink-0 text-muted-foreground">
              {typeof cell.column.columnDef.header === "string"
                ? cell.column.columnDef.header
                : cell.column.id}
            </dt>
            <dd className="min-w-0 text-right">
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </dd>
          </div>
        ))}
    </dl>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="rounded-lg border p-4"
      role="status"
      aria-label="Loading results"
    >
      <span className="sr-only">Loading results…</span>
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Loading…
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-4">
            <Skeleton className="h-4 w-4 shrink-0 rounded" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className={cn("hidden h-4 w-24 sm:block")} />
            <Skeleton className="hidden h-4 w-20 md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
