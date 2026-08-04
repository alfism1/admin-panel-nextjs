import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Runtime RBAC.
 *
 * Better-Auth's access-control statements are compile-time constants — great
 * for type safety, useless for "let an operator create a new role at 2am". So
 * roles and their grants live here in the database and are layered on top:
 * `users.role` holds role *keys*, this module resolves them to permissions.
 *
 * The statement in `src/lib/permissions.ts` remains the source of truth for
 * which `(resource, action)` pairs are *possible*; `permissions` rows are the
 * database projection of it, reconciled by the seed.
 */

export const roles = pgTable(
  "roles",
  {
    id: text("id").primaryKey(),
    /** Stable machine key stored in `users.role`, e.g. `super_admin`. */
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /**
     * System roles are seeded and cannot be renamed or deleted from the UI —
     * deleting `super_admin` would lock everyone out of the panel.
     */
    isSystem: boolean("is_system").notNull().default(false),
    /** Members of this role must complete TOTP enrolment before proceeding. */
    requireTwoFactor: boolean("require_two_factor").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("roles_key_unique").on(table.key)],
);

export const permissions = pgTable(
  "permissions",
  {
    id: text("id").primaryKey(),
    /** e.g. `user`, `role`, `auditLog`, `featureFlag`. */
    resource: text("resource").notNull(),
    /** e.g. `create`, `read`, `update`, `delete`, `ban`. */
    action: text("action").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("permissions_resource_action_unique").on(
      table.resource,
      table.action,
    ),
    index("permissions_resource_idx").on(table.resource),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: text("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
    index("role_permissions_permission_id_idx").on(table.permissionId),
  ],
);

export const rolesRelations = relations(roles, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(
  rolePermissions,
  ({ one }) => ({
    role: one(roles, {
      fields: [rolePermissions.roleId],
      references: [roles.id],
    }),
    permission: one(permissions, {
      fields: [rolePermissions.permissionId],
      references: [permissions.id],
    }),
  }),
);

export type RoleRow = typeof roles.$inferSelect;
export type NewRoleRow = typeof roles.$inferInsert;
export type PermissionRow = typeof permissions.$inferSelect;
export type RolePermissionRow = typeof rolePermissions.$inferSelect;
