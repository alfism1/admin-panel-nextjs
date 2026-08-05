import type { Metadata } from "next";

import { Forbidden } from "@/components/shared/forbidden";
import { parseTableParams } from "@/lib/table-params";
import { ProductsView } from "@/modules/products/components/products-view";
import { productsService } from "@/modules/products/products.service";
import { hasPermission } from "@/modules/rbac/permissions.service";

export const metadata: Metadata = { title: "Products" };

/**
 * Products index.
 *
 * Table state arrives as search params and goes straight to the service, so the
 * database does the paging and the client only ever receives one page.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The friendly screen for a signed-in user who lacks the permission. Not the
  // security boundary — `productsService.list` enforces the same check, and
  // that is what a REST client or a future CLI hits.
  if (!(await hasPermission("product", "read"))) {
    return <Forbidden />;
  }

  const params = parseTableParams(await searchParams);

  const { rows, total, totalCapped } = await productsService.list({
    page: params.page,
    pageSize: params.pageSize,
    // `parseTableParams` types `sort` as `string | null` because it is generic
    // over every table; the service's zod enum is what pins it to a real
    // column, rejecting anything else.
    sort: params.sort ?? "createdAt",
    order: params.order,
    search: params.search,
    status: params.filters.status,
  });

  return (
    <ProductsView
      products={rows.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        description: product.description,
        priceCents: product.priceCents,
        archived: product.archived,
        // Explicit projection, not a spread: `Date` has no wire format across
        // the RSC boundary, and a column added to the table later must not
        // start reaching the browser by accident.
        createdAt: product.createdAt.toISOString(),
      }))}
      totalRows={total}
      totalRowsCapped={totalCapped}
      params={params}
    />
  );
}
