import "server-only";

import { cache as reactCache } from "react";

import { ForbiddenError } from "@/lib/errors";
import {
  permissionKey,
  type ActionFor,
  type PermissionKey,
  type Resource,
} from "@/lib/permissions";
import { cache, cacheKeys, cacheTags, cacheTtl } from "@/modules/cache";

import { rbacRepository } from "./rbac.repository";
import {
  getFreshSession,
  roleKeysOf,
  type AuthSession,
  type AuthUser,
} from "./session";

/**
 * The authorization boundary.
 *
 * `requirePermission()` is the only function that decides whether an action is
 * allowed. Server Actions, Route Handlers and Server Components all call it;
 * the client-side `usePermission()` hook only hides UI and is never trusted.
 *
 * Resolution order for a request:
 *   session (fresh, never the cookie cache)
 *     → role keys from `users.role`
 *       → permission keys from the DB, memoised in Redis for 60s
 */

/**
 * Resolved permissions for one user. Redis-cached because it is read on
 * essentially every authorised request, and invalidated whenever a role's
 * grants change or a user's roles change.
 */
export async function getPermissionKeysForUser(
  userId: string,
  roleKeys: string[],
): Promise<Set<string>> {
  if (roleKeys.length === 0) return new Set();

  const keys = await cache.wrap(
    cacheKeys.userPermissions(userId),
    () => rbacRepository.findPermissionKeysForRoleKeys(roleKeys),
    {
      ttlSeconds: cacheTtl.permissions,
      // Both tags matter: a role's grants changing, or this user's roles
      // changing, must drop this entry.
      tags: [cacheTags.permissions, cacheTags.user(userId)],
    },
  );

  return new Set(keys);
}

export interface Authorization {
  session: AuthSession;
  user: AuthUser;
  roleKeys: string[];
  permissionKeys: Set<string>;
  has: (key: PermissionKey) => boolean;
}

/**
 * Loads the current user's full authorization context.
 *
 * `react.cache` keeps this to one resolution per render even when a page, its
 * layout, and half a dozen components each ask.
 */
export const getAuthorization = reactCache(
  async (): Promise<Authorization | null> => {
    const session = await getFreshSession();
    if (!session) return null;

    const roleKeys = roleKeysOf(session.user);
    const permissionKeys = await getPermissionKeysForUser(
      session.user.id,
      roleKeys,
    );

    return {
      session,
      user: session.user,
      roleKeys,
      permissionKeys,
      has: (key) => permissionKeys.has(key),
    };
  },
);

/**
 * Does the *current* user hold this permission? Returns a boolean — use it for
 * conditional rendering. For enforcement, use `requirePermission`.
 */
export async function hasPermission<R extends Resource>(
  resource: R,
  action: ActionFor<R>,
): Promise<boolean> {
  const authorization = await getAuthorization();
  if (!authorization) return false;
  return authorization.has(permissionKey(resource, action));
}

/**
 * Enforces a permission. Throws `ForbiddenError` (→ 403, or the `<Forbidden />`
 * boundary) when the caller lacks it, and `UnauthorizedError` when there is no
 * session at all.
 *
 * Returns the authorization context so call sites don't re-resolve the session.
 */
export async function requirePermission<R extends Resource>(
  resource: R,
  action: ActionFor<R>,
): Promise<Authorization> {
  const authorization = await getAuthorization();

  if (!authorization) {
    throw new ForbiddenError("You must be signed in to do that.", {
      resource,
      action,
    });
  }

  // A banned user keeps a valid session until it expires; refuse them here
  // rather than relying on sign-in being the only gate.
  if (isBanned(authorization.user)) {
    throw new ForbiddenError("This account is suspended.", {
      resource,
      action,
    });
  }

  if (!authorization.has(permissionKey(resource, action))) {
    throw new ForbiddenError(
      `You do not have permission to ${action} ${resource}.`,
      { resource, action },
    );
  }

  return authorization;
}

/** Every permission the current user holds — sent to the client for `usePermission`. */
export async function getCurrentPermissionKeys(): Promise<string[]> {
  const authorization = await getAuthorization();
  return authorization ? [...authorization.permissionKeys] : [];
}

export function isBanned(user: AuthUser): boolean {
  const banned = (user as { banned?: boolean | null }).banned;
  if (!banned) return false;

  const banExpires = (user as { banExpires?: Date | string | null }).banExpires;
  if (!banExpires) return true;

  // A ban with an elapsed expiry is no longer a ban.
  return new Date(banExpires).getTime() > Date.now();
}

/**
 * Privilege-escalation guard.
 *
 * Refuses to let an actor grant a set of permissions they don't themselves
 * hold — otherwise anyone with `role:create` could mint a role with
 * `user:delete` and assign it to themselves. Defence in depth: the seeded
 * `admin` role deliberately has no `role:assign`, but a custom role might.
 */
export function assertNoPrivilegeEscalation(
  actor: Authorization,
  requestedKeys: string[],
): void {
  const escalations = requestedKeys.filter(
    (key) => !actor.permissionKeys.has(key),
  );

  if (escalations.length > 0) {
    throw new ForbiddenError(
      "You cannot grant permissions you do not hold yourself: " +
        escalations.join(", "),
    );
  }
}

/** Drops a user's cached permission set. Call after changing their roles. */
export async function invalidateUserPermissions(userId: string): Promise<void> {
  await cache.invalidateTags(cacheTags.user(userId));
}

/** Drops every cached permission set. Call after changing a role's grants. */
export async function invalidateAllPermissions(): Promise<void> {
  await cache.invalidateTags(cacheTags.permissions);
}
