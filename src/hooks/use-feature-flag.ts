"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Client-side flag evaluation.
 *
 * Backed by `POST /api/feature-flags/evaluate`, which resolves the user from
 * the session — the browser cannot ask "is this on for someone else?".
 *
 * Server Components should call `isFeatureEnabled()` instead; this hook exists
 * for interactive components that need a flag to change without a redeploy or
 * a page reload.
 */

async function fetchFlags(keys: string[]): Promise<Record<string, boolean>> {
  const response = await fetch("/api/feature-flags/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys }),
  });

  if (!response.ok) {
    // Fail closed: an unreachable evaluator must not silently switch features
    // on for everyone.
    throw Object.assign(new Error("Failed to evaluate feature flags"), {
      status: response.status,
    });
  }

  const payload = (await response.json()) as { data: Record<string, boolean> };
  return payload.data;
}

export function useFeatureFlags(keys: string[]): {
  flags: Record<string, boolean>;
  isLoading: boolean;
} {
  // Sorted so `["a","b"]` and `["b","a"]` share one cache entry.
  const sorted = [...keys].sort();

  const query = useQuery({
    queryKey: ["feature-flags", sorted],
    queryFn: () => fetchFlags(sorted),
    enabled: sorted.length > 0,
    // Short: a flag flipped in the admin UI should reach open tabs quickly.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  return {
    flags: query.data ?? {},
    isLoading: query.isLoading,
  };
}

/**
 * `const showNewBilling = useFeatureFlag("new-billing")`
 *
 * Returns `false` while loading and on error — a flag is off until proven on.
 */
export function useFeatureFlag(key: string): boolean {
  const { flags } = useFeatureFlags([key]);
  return flags[key] ?? false;
}
