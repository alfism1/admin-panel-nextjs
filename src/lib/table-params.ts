/**
 * Table state that lives in the URL.
 *
 * Deliberately **not** a `"use client"` module: Server Components parse the
 * incoming `searchParams` with `parseTableParams` to build the database query,
 * and the client hook in `hooks/use-table-params.ts` reads the same shape back
 * out. One definition, so the two can't drift.
 *
 * Three reasons the URL is the source of truth in an admin panel:
 *  - a filtered view is a link you can paste into a ticket;
 *  - Back returns to the previous page of results, as users expect;
 *  - the server does the paging, so the client never holds the full dataset.
 */

export interface TableParams {
  page: number;
  pageSize: number;
  sort: string | null;
  order: "asc" | "desc";
  search: string;
  /** Everything in the query string that isn't a reserved key. */
  filters: Record<string, string>;
}

export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

const RESERVED = new Set(["page", "pageSize", "sort", "order", "search"]);

export function parseTableParams(
  searchParams: URLSearchParams | Record<string, string | string[] | undefined>,
): TableParams {
  const entries: [string, string][] =
    searchParams instanceof URLSearchParams
      ? [...searchParams.entries()]
      : Object.entries(searchParams).flatMap(([key, value]) => {
          const first = Array.isArray(value) ? value[0] : value;
          return first === undefined ? [] : [[key, first] as [string, string]];
        });

  const lookup = new Map(entries);
  const get = (key: string) => lookup.get(key);

  const page = Number.parseInt(get("page") ?? "1", 10);
  const pageSize = Number.parseInt(
    get("pageSize") ?? String(DEFAULT_PAGE_SIZE),
    10,
  );

  const filters: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!RESERVED.has(key) && value !== "") filters[key] = value;
  }

  return {
    // Clamp rather than trust: `?page=-1` or `?pageSize=1e9` must never reach
    // the repository and turn into an unbounded query.
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: isAllowedPageSize(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    sort: get("sort") ?? null,
    order: get("order") === "asc" ? "asc" : "desc",
    search: get("search") ?? "",
    filters,
  };
}

function isAllowedPageSize(value: number): boolean {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}
