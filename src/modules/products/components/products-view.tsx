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
  totalRowsCapped,
  params,
}: {
  products: ProductRow[];
  totalRows: number;
  totalRowsCapped: boolean;
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
        totalRowsCapped={totalRowsCapped}
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
