"use client";

import { useCallback, useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { parseTableParams } from "@/lib/table-params";

/**
 * Client-side reader/writer for the URL table state parsed by
 * `@/lib/table-params`. Writes go through the router, so every change is a real
 * navigation the Server Component re-renders from.
 */
export function useTableParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const params = useMemo(
    () => parseTableParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const update = useCallback(
    (patch: Record<string, string | number | null | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === "") {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      }

      // Any change other than paging invalidates the page number — filtering
      // down to 3 results while on page 7 would show an empty table.
      if (!("page" in patch)) next.delete("page");

      startTransition(() => {
        router.push(`${pathname}?${next.toString()}`, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  const toggleSort = useCallback(
    (column: string) => {
      const isCurrent = params.sort === column;
      update({
        sort: column,
        order: isCurrent && params.order === "desc" ? "asc" : "desc",
      });
    },
    [params.order, params.sort, update],
  );

  const reset = useCallback(() => {
    startTransition(() => {
      router.push(pathname, { scroll: false });
    });
  }, [pathname, router]);

  return { params, update, toggleSort, reset, isPending };
}

export {
  parseTableParams,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  type TableParams,
} from "@/lib/table-params";
