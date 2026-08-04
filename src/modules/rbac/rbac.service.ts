import "server-only";

import type { PermissionRow, RoleRow } from "@/db/schema";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { cacheTags, invalidateQueryTags } from "@/modules/cache";
import { logAudit } from "@/modules/audit-log/audit-log.service";

import {
  assertNoPrivilegeEscalation,
  invalidateAllPermissions,
  requirePermission,
} from "./permissions.service";
import { rbacRepository, type RoleWithPermissions } from "./rbac.repository";
import {
  createRoleSchema,
  roleIdSchema,
  updateRolePermissionsSchema,
  updateRoleSchema,
} from "./rbac.schema";

/**
 * Role management.
 *
 * The invariant that matters here: a role may never be created or edited to
 * grant a permission its author doesn't already hold
 * (`assertNoPrivilegeEscalation`). Without it, `role:create` silently means
 * "grant yourself anything", and the RBAC system is decorative.
 */

async function listRoles(): Promise<RoleWithPermissions[]> {
  await requirePermission("role", "read");
  return rbacRepository.listRolesWithPermissions();
}

async function listPermissions(): Promise<PermissionRow[]> {
  await requirePermission("role", "read");
  return rbacRepository.listPermissions();
}

async function findRoleById(id: string): Promise<RoleWithPermissions> {
  await requirePermission("role", "read");
  const roles = await rbacRepository.listRolesWithPermissions();
  const role = roles.find((candidate) => candidate.id === id);
  if (!role) throw new NotFoundError("Role", id);
  return role;
}

/** Role keys + names for assignment dropdowns. Needs `role:read` only. */
async function listAssignableRoles(): Promise<
  { key: string; name: string; description: string | null }[]
> {
  await requirePermission("role", "read");
  const roles = await rbacRepository.listRoles();
  return roles.map((role) => ({
    key: role.key,
    name: role.name,
    description: role.description,
  }));
}

async function create(input: unknown): Promise<RoleRow> {
  const actor = await requirePermission("role", "create");
  const values = createRoleSchema.parse(input);

  if (await rbacRepository.isKeyTaken(values.key)) {
    throw new ConflictError(
      `A role with the key "${values.key}" already exists.`,
    );
  }

  assertNoPrivilegeEscalation(actor, values.permissionKeys);

  const role = await rbacRepository.createRole({
    key: values.key,
    name: values.name,
    description: values.description ?? null,
    requireTwoFactor: values.requireTwoFactor,
  });

  await rbacRepository.replaceRolePermissions(role.id, values.permissionKeys);

  await logAudit({
    action: "role.created",
    resourceType: "role",
    resourceId: role.key,
    after: {
      key: role.key,
      name: role.name,
      requireTwoFactor: role.requireTwoFactor,
      permissionKeys: values.permissionKeys,
    },
  });

  await invalidate();
  return role;
}

async function update(input: unknown): Promise<RoleRow> {
  await requirePermission("role", "update");
  const values = updateRoleSchema.parse(input);

  const before = await rbacRepository.findRoleById(values.id);
  if (!before) throw new NotFoundError("Role", values.id);

  const role = await rbacRepository.updateRole(values.id, {
    name: values.name,
    description: values.description ?? null,
    requireTwoFactor: values.requireTwoFactor,
  });
  if (!role) throw new NotFoundError("Role", values.id);

  await logAudit({
    action: "role.updated",
    resourceType: "role",
    resourceId: role.key,
    before: {
      name: before.name,
      description: before.description,
      requireTwoFactor: before.requireTwoFactor,
    },
    after: {
      name: role.name,
      description: role.description,
      requireTwoFactor: role.requireTwoFactor,
    },
  });

  await invalidate();
  return role;
}

async function updatePermissions(input: unknown): Promise<RoleWithPermissions> {
  const actor = await requirePermission("role", "update");
  const values = updateRolePermissionsSchema.parse(input);

  const roles = await rbacRepository.listRolesWithPermissions();
  const before = roles.find((role) => role.id === values.id);
  if (!before) throw new NotFoundError("Role", values.id);

  assertNoPrivilegeEscalation(actor, values.permissionKeys);

  // Editing your own role's grants down mid-session is how an operator locks
  // themselves out of the page they're standing on.
  if (actor.roleKeys.includes(before.key)) {
    const removed = before.permissionKeys.filter(
      (key) => !values.permissionKeys.includes(key),
    );
    if (removed.includes("role:update") || removed.includes("role:read")) {
      throw new BadRequestError(
        "You cannot remove your own ability to manage roles — ask another administrator to do it.",
      );
    }
  }

  await rbacRepository.replaceRolePermissions(values.id, values.permissionKeys);

  await logAudit({
    action: "role.permissions_updated",
    resourceType: "role",
    resourceId: before.key,
    before: { permissionKeys: before.permissionKeys.sort() },
    after: { permissionKeys: [...values.permissionKeys].sort() },
  });

  await invalidate();

  const after = (await rbacRepository.listRolesWithPermissions()).find(
    (role) => role.id === values.id,
  );
  if (!after) throw new NotFoundError("Role", values.id);
  return after;
}

async function remove(input: unknown): Promise<void> {
  await requirePermission("role", "delete");
  const { id } = roleIdSchema.parse(input);

  const role = await rbacRepository.findRoleById(id);
  if (!role) throw new NotFoundError("Role", id);

  if (role.isSystem) {
    throw new BadRequestError(
      `"${role.name}" is a system role and cannot be deleted. Create a custom role instead.`,
    );
  }

  // Deleting a role out from under its members would silently strip their
  // access with no record of what they used to have.
  const members = await rbacRepository.countUsersWithRoleKey(role.key);
  if (members > 0) {
    throw new ConflictError(
      `${members} ${members === 1 ? "user is" : "users are"} still assigned this role. Reassign them first.`,
    );
  }

  await rbacRepository.deleteRole(id);

  await logAudit({
    action: "role.deleted",
    resourceType: "role",
    resourceId: role.key,
    before: { key: role.key, name: role.name },
  });

  await invalidate();
}

async function invalidate(): Promise<void> {
  // Any grant change invalidates every cached permission set, not just one
  // user's — a role edit changes access for everyone holding it.
  await invalidateAllPermissions();
  invalidateQueryTags(cacheTags.roles, cacheTags.permissions);
}

export const rbacService = {
  listRoles,
  listPermissions,
  listAssignableRoles,
  findRoleById,
  create,
  update,
  updatePermissions,
  remove,
};

export type { RoleWithPermissions };
