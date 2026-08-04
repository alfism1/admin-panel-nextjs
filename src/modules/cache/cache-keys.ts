/**
 * Every cache key and tag in the app is declared here.
 *
 * Keys built inline at the call site inevitably drift from the invalidation
 * that is supposed to clear them. Centralising them makes "what does this write
 * invalidate?" answerable by reading one file.
 */

export const cacheTags = {
  users: "users",
  user: (id: string) => `user:${id}`,
  roles: "roles",
  role: (id: string) => `role:${id}`,
  permissions: "permissions",
  featureFlags: "feature-flags",
  featureFlag: (key: string) => `feature-flag:${key}`,
  auditLogs: "audit-logs",
} as const;

export const cacheKeys = {
  featureFlag: (key: string) => `flag:${key}`,
  featureFlagList: () => "flag:__list__",
  userPermissions: (userId: string) => `perms:user:${userId}`,
  rolePermissions: (roleId: string) => `perms:role:${roleId}`,
} as const;

/** TTLs in seconds, named so call sites read as intent rather than magic numbers. */
export const cacheTtl = {
  /** Flags change rarely but must propagate fast when they do. */
  featureFlag: 30,
  /** Permission sets are hot on every request and change rarely. */
  permissions: 60,
  short: 15,
  medium: 300,
} as const;
