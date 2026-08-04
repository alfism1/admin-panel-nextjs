"use client";

import { createContext, useContext, useMemo } from "react";

import {
  permissionKey,
  type ActionFor,
  type PermissionKey,
  type Resource,
} from "@/lib/permissions";

/**
 * Client-side mirror of the current user's permissions.
 *
 * **This hides UI. It does not protect anything.** Every value here arrived
 * over the wire and can be edited in a debugger. Each action gated by
 * `usePermission` must also be gated by `requirePermission` on the server —
 * the hook exists so users aren't shown buttons that will 403.
 *
 * The set is resolved once in the dashboard layout (a Server Component) and
 * passed down, so no client fetch is needed on first paint.
 */

const PermissionContext = createContext<ReadonlySet<string> | null>(null);

export function PermissionProvider({
  permissionKeys,
  children,
}: {
  permissionKeys: string[];
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => new Set(permissionKeys),
    // A new array identity each render is expected (it comes from the server);
    // the contents are what matter.
    [permissionKeys],
  );

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

function usePermissionSet(): ReadonlySet<string> {
  const value = useContext(PermissionContext);
  if (!value) {
    throw new Error(
      "usePermission must be used inside <PermissionProvider> — it is mounted by the dashboard layout.",
    );
  }
  return value;
}

/** `const canBan = usePermission("user", "ban")` */
export function usePermission<R extends Resource>(
  resource: R,
  action: ActionFor<R>,
): boolean {
  return usePermissionSet().has(permissionKey(resource, action));
}

/**
 * Permission check by raw `"resource:action"` key.
 *
 * For data-driven call sites (the nav config, the command palette) where the
 * key is a value rather than a literal, so the typed overload can't apply.
 * `null` means "not gated" and always returns true.
 */
export function useHasPermissionKey(key: PermissionKey | null): boolean {
  const set = usePermissionSet();
  return key === null || set.has(key);
}

/** True only if the user holds every one of the given permissions. */
export function usePermissions(required: readonly PermissionKey[]): boolean {
  const set = usePermissionSet();
  return required.every((key) => set.has(key));
}

/**
 * Renders `children` only when the permission is held. Prefer hiding over
 * disabling: a disabled button still advertises a capability the user doesn't
 * have, and invites them to go looking for a way around it.
 */
export function Can<R extends Resource>({
  resource,
  action,
  fallback = null,
  children,
}: {
  resource: R;
  action: ActionFor<R>;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const allowed = usePermission(resource, action);
  return <>{allowed ? children : fallback}</>;
}
