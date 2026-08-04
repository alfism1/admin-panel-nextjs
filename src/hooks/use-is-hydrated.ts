"use client";

import { useSyncExternalStore } from "react";

/** No-op subscribe: the value never changes after the first client render. */
const subscribe = () => () => {};

/**
 * `false` during SSR and the hydration pass, `true` afterwards.
 *
 * The alternative — `useState(false)` plus `useEffect(() => setMounted(true))`
 * — schedules an extra render pass and trips `react-hooks/set-state-in-effect`.
 * `useSyncExternalStore` expresses the same thing as what it actually is: a
 * value that differs between the server and client snapshots.
 *
 * Use it to gate anything that reads a browser-only source (localStorage, the
 * resolved colour scheme) and would otherwise cause a hydration mismatch.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
