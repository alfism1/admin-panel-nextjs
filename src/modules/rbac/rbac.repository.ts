import "server-only";

import { and, asc, count, eq, inArray, ne } from "drizzle-orm";

import { db, type Database } from "@/db/client";
import { newId } from "@/db/id";
import {
  permissions,
  rolePermissions,
  roles,
  user as userTable,
  type PermissionRow,
  type RoleRow,
} from "@/db/schema";

/**
 * Data access for roles and permissions. The only layer that touches Drizzle
 * for this domain — services compose these, transports never call them.
 */

export interface RoleWithPermissions extends RoleRow {
  /** `"user:ban"`-style keys. */
  permissionKeys: string[];
  memberCount: number;
}

async function listPermissions(): Promise<PermissionRow[]> {
  return db
    .select()
    .from(permissions)
    .orderBy(asc(permissions.resource), asc(permissions.action));
}

async function listRoles(): Promise<RoleRow[]> {
  return db.select().from(roles).orderBy(asc(roles.name));
}

/**
 * Roles with their grants and member counts.
 *
 * Three queries rather than one join: the join would multiply rows by grants ×
 * members and need de-duplicating in JS anyway. At the scale of a role list
 * (tens of rows) three indexed reads are cheaper and far easier to read.
 */
async function listRolesWithPermissions(): Promise<RoleWithPermissions[]> {
  const roleRows = await listRoles();
  if (roleRows.length === 0) return [];

  const roleIds = roleRows.map((role) => role.id);

  const grants = await db
    .select({
      roleId: rolePermissions.roleId,
      resource: permissions.resource,
      action: permissions.action,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(inArray(rolePermissions.roleId, roleIds));

  const memberCounts = await db
    .select({ role: userTable.role, total: count() })
    .from(userTable)
    .groupBy(userTable.role);

  const keysByRole = new Map<string, string[]>();
  for (const grant of grants) {
    const existing = keysByRole.get(grant.roleId) ?? [];
    existing.push(`${grant.resource}:${grant.action}`);
    keysByRole.set(grant.roleId, existing);
  }

  // `users.role` is comma-separated, so one row can contribute to several roles.
  const membersByRoleKey = new Map<string, number>();
  for (const row of memberCounts) {
    for (const key of (row.role ?? "").split(",")) {
      const trimmed = key.trim();
      if (!trimmed) continue;
      membersByRoleKey.set(
        trimmed,
        (membersByRoleKey.get(trimmed) ?? 0) + row.total,
      );
    }
  }

  return roleRows.map((role) => ({
    ...role,
    permissionKeys: keysByRole.get(role.id) ?? [],
    memberCount: membersByRoleKey.get(role.key) ?? 0,
  }));
}

async function findRoleById(id: string): Promise<RoleRow | null> {
  const [row] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  return row ?? null;
}

async function findRoleByKey(key: string): Promise<RoleRow | null> {
  const [row] = await db
    .select()
    .from(roles)
    .where(eq(roles.key, key))
    .limit(1);
  return row ?? null;
}

/**
 * The union of permissions granted by `roleKeys`.
 *
 * A single query with `inArray` — resolving each role separately would be N+1
 * on the hottest path in the app (every authorised request).
 */
async function findPermissionKeysForRoleKeys(
  roleKeys: string[],
): Promise<string[]> {
  if (roleKeys.length === 0) return [];

  const rows = await db
    .selectDistinct({
      resource: permissions.resource,
      action: permissions.action,
    })
    .from(roles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(inArray(roles.key, roleKeys));

  return rows.map((row) => `${row.resource}:${row.action}`);
}

async function findRolesByKeys(roleKeys: string[]): Promise<RoleRow[]> {
  if (roleKeys.length === 0) return [];
  return db.select().from(roles).where(inArray(roles.key, roleKeys));
}

async function isKeyTaken(
  key: string,
  exceptRoleId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(
      exceptRoleId
        ? and(eq(roles.key, key), ne(roles.id, exceptRoleId))
        : eq(roles.key, key),
    )
    .limit(1);
  return Boolean(row);
}

async function createRole(values: {
  key: string;
  name: string;
  description: string | null;
  requireTwoFactor: boolean;
}): Promise<RoleRow> {
  const [row] = await db
    .insert(roles)
    .values({ id: newId(), ...values, isSystem: false })
    .returning();
  if (!row) throw new Error("Insert into roles returned no row.");
  return row;
}

async function updateRole(
  id: string,
  values: Partial<{
    name: string;
    description: string | null;
    requireTwoFactor: boolean;
  }>,
): Promise<RoleRow | null> {
  const [row] = await db
    .update(roles)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(roles.id, id))
    .returning();
  return row ?? null;
}

async function deleteRole(id: string): Promise<void> {
  await db.delete(roles).where(eq(roles.id, id));
}

/**
 * Replaces a role's grants wholesale, in a transaction.
 *
 * Delete-then-insert rather than diffing: the permission matrix submits a
 * complete desired state, and a partial application of it would silently leave
 * a role with privileges the operator just unticked.
 */
async function replaceRolePermissions(
  roleId: string,
  permissionKeys: string[],
  tx: Database = db,
): Promise<void> {
  await tx.transaction(async (trx) => {
    await trx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (permissionKeys.length === 0) return;

    const wanted = await trx.select().from(permissions);
    const idByKey = new Map(
      wanted.map((row) => [`${row.resource}:${row.action}`, row.id]),
    );

    const rows = permissionKeys
      .map((key) => idByKey.get(key))
      .filter((permissionId): permissionId is string => Boolean(permissionId))
      .map((permissionId) => ({ roleId, permissionId }));

    if (rows.length > 0) await trx.insert(rolePermissions).values(rows);
  });
}

async function countUsersWithRoleKey(roleKey: string): Promise<number> {
  const rows = await db
    .select({ role: userTable.role, total: count() })
    .from(userTable)
    .groupBy(userTable.role);

  let total = 0;
  for (const row of rows) {
    const keys = (row.role ?? "").split(",").map((key) => key.trim());
    if (keys.includes(roleKey)) total += row.total;
  }
  return total;
}

export const rbacRepository = {
  listPermissions,
  listRoles,
  listRolesWithPermissions,
  findRoleById,
  findRoleByKey,
  findRolesByKeys,
  findPermissionKeysForRoleKeys,
  isKeyTaken,
  createRole,
  updateRole,
  deleteRole,
  replaceRolePermissions,
  countUsersWithRoleKey,
};
