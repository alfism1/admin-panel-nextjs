"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A boolean persisted in `localStorage`, read through `useSyncExternalStore`.
 *
 * localStorage genuinely *is* an external store, so this is what the hook is
 * for: it gives a correct server snapshot (the fallback), stays in sync across
 * tabs via the `storage` event, and avoids the read-in-effect-then-setState
 * pattern that causes a second render on every mount.
 */
export function useLocalStorageFlag(
  key: string,
  fallback = false,
): [boolean, (next: boolean) => void] {
  const subscribe = useCallback((onStoreChange: () => void) => {
    // `storage` fires in *other* tabs; the custom event covers this one.
    window.addEventListener("storage", onStoreChange);
    window.addEventListener(EVENT_NAME, onStoreChange);
    return () => {
      window.removeEventListener("storage", onStoreChange);
      window.removeEventListener(EVENT_NAME, onStoreChange);
    };
  }, []);

  const getSnapshot = useCallback(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? fallback : stored === "true";
    } catch {
      // Safari in private mode throws on access.
      return fallback;
    }
  }, [key, fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, () => fallback);

  const setValue = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Ignore: a preference that can't be persisted still applies to the
        // current page.
      }
      window.dispatchEvent(new Event(EVENT_NAME));
    },
    [key],
  );

  return [value, setValue];
}

const EVENT_NAME = "modern-admin:local-storage";
