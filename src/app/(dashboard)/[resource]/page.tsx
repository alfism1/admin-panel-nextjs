import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Forbidden } from "@/components/shared/forbidden";
import type { ActionFor, Resource } from "@/lib/permissions";
import { findBackendBySegment } from "@/lib/resource/registry.server";
import { ResourceIndex } from "@/lib/resource/resource-index";
import { parseTableParams } from "@/lib/table-params";
import { hasPermission } from "@/modules/rbac/permissions.service";

/**
 * The index route every registered resource is served from.
 *
 * One dynamic segment instead of a `page.tsx` per module. Static segments win
 * over dynamic ones in Next's matcher, so `/users`, `/roles` and the rest still
 * resolve to their own files — this only catches paths nothing else claims, and
 * 404s the ones that aren't a registered resource.
 *
 * Table state arrives as search params and goes straight to the service, so the
 * database does the paging and the client only ever receives one page.
 */

type PageProps = {
  params: Promise<{ resource: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { resource } = await params;
  const backend = findBackendBySegment(resource);
  return { title: backend?.descriptor.pluralLabel ?? "Not found" };
}

export default async function ResourceIndexPage({
  params,
  searchParams,
}: PageProps) {
  const { resource } = await params;
  const backend = findBackendBySegment(resource);
  if (!backend) notFound();

  const { descriptor, service } = backend;

  // The friendly screen for a signed-in user who lacks the permission. Not the
  // security boundary — `service.list` enforces the same check, and that is
  // what a REST client or a future CLI hits.
  if (
    !(await hasPermission(
      descriptor.name as Resource,
      "read" as ActionFor<Resource>,
    ))
  ) {
    return <Forbidden />;
  }

  const tableParams = parseTableParams(await searchParams);

  // `parseTableParams` types `sort` as `string | null` because it is generic
  // over every table. Falling back here keeps a stale link from a renamed
  // column rendering an error page instead of the first page of results.
  const sort =
    tableParams.sort && descriptor.sortKeys.includes(tableParams.sort)
      ? tableParams.sort
      : descriptor.defaultSort;

  const { records, total, totalCapped } = await service.list({
    page: tableParams.page,
    pageSize: tableParams.pageSize,
    sort,
    order: tableParams.order,
    search: tableParams.search,
    // Unknown keys are stripped by the descriptor's zod schema, so a junk query
    // parameter can't reach the repository.
    ...tableParams.filters,
  });

  return (
    <ResourceIndex
      resource={descriptor.name}
      records={records}
      totalRows={total}
      totalRowsCapped={totalCapped}
      params={tableParams}
    />
  );
}
