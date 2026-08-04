import { QueryClient } from "@tanstack/react-query";

/**
 * Defaults tuned for an admin panel: data is mostly server-rendered, and
 * client queries exist for things that change out-of-band (feature flags,
 * live-filtered tables). A 30s stale window stops every focus change from
 * re-fetching the world.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Never retry an authz/authn failure — it will never succeed.
          const status = (error as { status?: number }).status;
          if (status === 401 || status === 403 || status === 404) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
