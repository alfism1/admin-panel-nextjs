import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";

/**
 * The access-control statement: every `(resource, action)` pair the app knows
 * how to authorise. This is the compile-time source of truth — the `roles`
 * and `permissions` tables are its runtime projection, reconciled by the seed
 * (`syncPermissionCatalog`).
 *
 * Adding a resource here and re-running `pnpm db:seed` makes it appear in the
 * Roles permission matrix with no other code changes.
 *
 * The `user` and `session` action lists are a superset of Better-Auth's
 * `defaultStatements`: its built-in admin endpoints authorise against names
 * like `list`, `set-role` and `impersonate`, so dropping them would break
 * `/api/auth/admin/*`. The friendlier `read` alias is ours, and every role that
 * gets `read` is also granted `list`/`get` by the seed.
 */
export const statement = {
  user: [
    "create",
    "read",
    "list",
    "get",
    "update",
    "delete",
    "ban",
    "set-role",
    "set-password",
    "set-email",
    "impersonate",
    "impersonate-admins",
  ],
  session: ["list", "revoke", "delete"],
  role: ["create", "read", "update", "delete", "assign"],
  auditLog: ["read", "export"],
  featureFlag: ["create", "read", "update", "delete", "toggle"],
} as const satisfies Record<string, readonly string[]>;

export const ac = createAccessControl(statement);

export type Statement = typeof statement;
export type Resource = keyof Statement;
export type ActionFor<R extends Resource> = Statement[R][number];

/** `"user:ban"`-style key, used as the wire format between server and client. */
export type PermissionKey = {
  [R in Resource]: `${R}:${ActionFor<R>}`;
}[Resource];

export const RESOURCES = Object.keys(statement) as Resource[];

export function permissionKey<R extends Resource>(
  resource: R,
  action: ActionFor<R>,
): PermissionKey {
  return `${resource}:${action}` as PermissionKey;
}

export function parsePermissionKey(
  key: string,
): { resource: Resource; action: string } | null {
  const separator = key.indexOf(":");
  if (separator <= 0) return null;
  const resource = key.slice(0, separator);
  const action = key.slice(separator + 1);
  if (!isResource(resource)) return null;
  if (!(statement[resource] as readonly string[]).includes(action)) return null;
  return { resource, action };
}

export function isResource(value: string): value is Resource {
  return Object.hasOwn(statement, value);
}

/** Every possible permission key, in declaration order. */
export const ALL_PERMISSION_KEYS: PermissionKey[] = RESOURCES.flatMap(
  (resource) =>
    (statement[resource] as readonly string[]).map(
      (action) => `${resource}:${action}` as PermissionKey,
    ),
);

// ---------------------------------------------------------------------------
// Seeded roles
// ---------------------------------------------------------------------------

/** Role keys that ship with the boilerplate and cannot be deleted from the UI. */
export const SYSTEM_ROLE_KEYS = ["super_admin", "admin", "viewer"] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

type RoleGrants = {
  [R in Resource]?: readonly ActionFor<R>[];
};

export interface SystemRoleDefinition {
  key: SystemRoleKey;
  name: string;
  description: string;
  /** Members must complete TOTP enrolment before using the panel. */
  requireTwoFactor: boolean;
  grants: RoleGrants;
}

const allActions = <R extends Resource>(resource: R): readonly ActionFor<R>[] =>
  statement[resource] as unknown as readonly ActionFor<R>[];

export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    key: "super_admin",
    name: "Super Admin",
    description:
      "Unrestricted access, including roles, permissions and impersonation.",
    // The account that can grant itself anything is the one worth protecting.
    requireTwoFactor: true,
    grants: {
      user: allActions("user"),
      session: allActions("session"),
      role: allActions("role"),
      auditLog: allActions("auditLog"),
      featureFlag: allActions("featureFlag"),
    },
  },
  {
    key: "admin",
    name: "Admin",
    description:
      "Manages users and content. Cannot edit roles, permissions, or impersonate other admins.",
    requireTwoFactor: false,
    grants: {
      user: [
        "create",
        "read",
        "list",
        "get",
        "update",
        "delete",
        "ban",
        "set-password",
        "set-email",
        "impersonate",
      ],
      session: ["list", "revoke", "delete"],
      // Read-only on roles: granting `assign` here would let an admin promote
      // themselves to super_admin.
      role: ["read"],
      auditLog: ["read", "export"],
      featureFlag: allActions("featureFlag"),
    },
  },
  {
    key: "viewer",
    name: "Viewer",
    description: "Read-only access to every section of the panel.",
    requireTwoFactor: false,
    grants: {
      user: ["read", "list", "get"],
      role: ["read"],
      auditLog: ["read"],
      featureFlag: ["read"],
    },
  },
] as const;

export function grantsToPermissionKeys(grants: RoleGrants): PermissionKey[] {
  const keys: PermissionKey[] = [];
  for (const resource of RESOURCES) {
    const actions = grants[resource] as readonly string[] | undefined;
    if (!actions) continue;
    for (const action of actions) {
      keys.push(`${resource}:${action}` as PermissionKey);
    }
  }
  return keys;
}

/**
 * Role objects handed to Better-Auth's `admin` plugin so its built-in
 * `/api/auth/admin/*` endpoints authorise consistently with our own guards.
 *
 * These cover the seeded roles only. Roles created at runtime are enforced by
 * `requirePermission()` against the database — see `modules/rbac`.
 */
export const betterAuthRoles = Object.fromEntries(
  SYSTEM_ROLES.map((role) => [
    role.key,
    ac.newRole(role.grants as Parameters<typeof ac.newRole>[0]),
  ]),
);

/**
 * Guards against a Better-Auth upgrade introducing a `user`/`session` action we
 * don't declare — which would make its admin endpoints unauthorisable and fail
 * silently at runtime. Returns the missing actions; the unit tests assert it is
 * empty.
 */
export function findUndeclaredDefaultActions(): string[] {
  const missing: string[] = [];
  for (const [resource, actions] of Object.entries(defaultStatements)) {
    const declared = isResource(resource)
      ? (statement[resource] as readonly string[])
      : [];
    for (const action of actions) {
      if (!declared.includes(action)) missing.push(`${resource}:${action}`);
    }
  }
  return missing;
}
