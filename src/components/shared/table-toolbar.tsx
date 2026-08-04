"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTableParams } from "@/hooks/use-table-params";

export interface ToolbarFilter {
  /** Query-string key. */
  name: string;
  label: string;
  options: { value: string; label: string }[];
}

/** Sentinel for "no filter" — Radix Select rejects an empty string value. */
const ALL = "__all__";

/**
 * Search + filter bar for `DataTable`.
 *
 * The search box is debounced and writes to the URL, so typing doesn't fire a
 * request per keystroke but the resulting view is still linkable.
 */
export function TableToolbar({
  searchPlaceholder = "Search…",
  filters = [],
  actions,
}: {
  searchPlaceholder?: string;
  filters?: ToolbarFilter[];
  actions?: React.ReactNode;
}) {
  const { params, update, reset } = useTableParams();
  const [search, setSearch] = useState(params.search);

  /**
   * Adjust the input when the URL changes from elsewhere — Back, or the "clear
   * filters" button. This is React's documented "adjusting state when a prop
   * changes" pattern: comparing during render and setting state immediately is
   * cheaper than an effect (React re-renders this component before touching
   * the DOM) and doesn't fight the user mid-keystroke.
   */
  const [lastUrlSearch, setLastUrlSearch] = useState(params.search);
  if (params.search !== lastUrlSearch) {
    setLastUrlSearch(params.search);
    setSearch(params.search);
  }

  // Debounced write-back, so typing costs one navigation rather than one per
  // keystroke.
  useEffect(() => {
    if (search === params.search) return;
    const timeout = setTimeout(() => update({ search }), 300);
    return () => clearTimeout(timeout);
  }, [search, params.search, update]);

  const isFiltered =
    params.search.trim() !== "" || Object.keys(params.filters).length > 0;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="pl-8"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {filters.map((filter) => (
          <Select
            key={filter.name}
            value={params.filters[filter.name] ?? ALL}
            onValueChange={(value) =>
              update({ [filter.name]: value === ALL ? null : value })
            }
          >
            <SelectTrigger
              size="sm"
              className="min-w-32"
              aria-label={filter.label}
            >
              <SelectValue placeholder={filter.label} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                All {filter.label.toLowerCase()}
              </SelectItem>
              {filter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}

        {isFiltered ? (
          <Button type="button" variant="ghost" size="sm" onClick={reset}>
            <X className="size-4" aria-hidden />
            Clear
          </Button>
        ) : null}

        {actions ? <div className="ml-auto">{actions}</div> : null}
      </div>
    </div>
  );
}
