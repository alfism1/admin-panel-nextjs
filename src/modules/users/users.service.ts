import "server-only";

import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/errors";
import { cacheTags, invalidateQueryTags } from "@/modules/cache";
import { logAudit } from "@/modules/audit-log/audit-log.service";
import {
  assertNoPrivilegeEscalation,
  invalidateUserPermissions,
  requirePermission,
} from "@/modules/rbac/permissions.service";
import { rbacRepository } from "@/modules/rbac/rbac.repository";

import { usersRepository, type UserListItem } from "./users.repository";
import {
  assignRoleSchema,
  banUserSchema,
  bulkUserActionSchema,
  createUserSchema,
  listUsersSchema,
  setPasswordSchema,
  updateUserSchema,
  userIdSchema,
} from "./users.schema";

/**
 * User management.
 *
 * Every mutation here: authorises → validates → acts → audits → invalidates.
 * That order is deliberate; skipping the audit step is the one thing a reviewer
 * should always catch.
 *
 * Password-bearing operations delegate to `auth.api.*` rather than writing the
 * `accounts` table directly, so hashes always match what sign-in verifies.
 */

async function list(
  input: unknown,
): Promise<{ rows: UserListItem[]; total: number }> {
  await requirePermission("user", "read");
  return usersRepository.list(listUsersSchema.parse(input));
}

async function findById(id: string): Promise<UserListItem> {
  await requirePermission("user", "read");
  const user = await usersRepository.findById(id);
  if (!user) throw new NotFoundError("User", id);
  return user;
}

async function getStats() {
  return usersRepository.stats();
}

async function listSessions(userId: string) {
  await requirePermission("session", "list");
  return usersRepository.listActiveSessions(userId);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

async function create(input: unknown): Promise<UserListItem> {
  const actor = await requirePermission("user", "create");
  const values = createUserSchema.parse(input);

  if (await usersRepository.findByEmail(values.email)) {
    throw new ConflictError("An account with that e-mail already exists.");
  }

  if (values.role) {
    await assertRoleAssignable(actor, [values.role]);
  }

  // Through Better-Auth so the password hash matches the sign-in verifier.
  const created = await auth.api.signUpEmail({
    body: {
      name: values.name,
      email: values.email,
      password: values.password,
    },
  });

  if (values.role || values.markVerified) {
    await usersRepository.updateProfile(created.user.id, {
      ...(values.markVerified ? { emailVerified: true } : {}),
    });
    if (values.role) {
      await usersRepository.setRoles(created.user.id, [values.role]);
    }
  }

  const user = await usersRepository.findById(created.user.id);
  if (!user) throw new NotFoundError("User", created.user.id);

  await logAudit({
    action: "user.created",
    resourceType: "user",
    resourceId: user.id,
    after: snapshot(user),
  });

  await invalidateUser(user.id);
  return user;
}

async function update(input: unknown): Promise<UserListItem> {
  await requirePermission("user", "update");
  const values = updateUserSchema.parse(input);

  const before = await usersRepository.findById(values.id);
  if (!before) throw new NotFoundError("User", values.id);

  if (values.email !== before.email) {
    const clash = await usersRepository.findByEmail(values.email);
    if (clash && clash.id !== values.id) {
      throw new ConflictError("Another account already uses that e-mail.");
    }
    await requirePermission("user", "set-email");
  }

  await usersRepository.updateProfile(values.id, {
    name: values.name,
    email: values.email,
    // Changing an address un-verifies it; anything else would let an admin
    // hand someone a verified address they don't control.
    ...(values.email !== before.email ? { emailVerified: false } : {}),
  });

  const after = await usersRepository.findById(values.id);
  if (!after) throw new NotFoundError("User", values.id);

  await logAudit({
    action: "user.updated",
    resourceType: "user",
    resourceId: after.id,
    before: snapshot(before),
    after: snapshot(after),
  });

  await invalidateUser(after.id);
  return after;
}

async function assignRoles(input: unknown): Promise<UserListItem> {
  const actor = await requirePermission("role", "assign");
  const values = assignRoleSchema.parse(input);

  const before = await usersRepository.findById(values.id);
  if (!before) throw new NotFoundError("User", values.id);

  await assertRoleAssignable(actor, values.roleKeys);

  // Losing your own last privileged role locks you out of the page you're on.
  if (values.id === actor.user.id && values.roleKeys.length === 0) {
    throw new BadRequestError("You cannot remove every role from yourself.");
  }

  await usersRepository.setRoles(values.id, values.roleKeys);

  const after = await usersRepository.findById(values.id);
  if (!after) throw new NotFoundError("User", values.id);

  await logAudit({
    action: "user.role_changed",
    resourceType: "user",
    resourceId: after.id,
    before: { roleKeys: before.roleKeys },
    after: { roleKeys: after.roleKeys },
  });

  await invalidateUser(after.id);
  return after;
}

async function ban(input: unknown): Promise<UserListItem> {
  const actor = await requirePermission("user", "ban");
  const values = banUserSchema.parse(input);

  if (values.id === actor.user.id) {
    throw new BadRequestError("You cannot ban yourself.");
  }

  const before = await usersRepository.findById(values.id);
  if (!before) throw new NotFoundError("User", values.id);

  await assertNotProtected(actor, before, "ban");

  await auth.api.banUser({
    body: {
      userId: values.id,
      banReason: values.reason,
      ...(values.expiresInDays
        ? { banExpiresIn: values.expiresInDays * 24 * 60 * 60 }
        : {}),
    },
    headers: await headers(),
  });

  const after = await usersRepository.findById(values.id);
  if (!after) throw new NotFoundError("User", values.id);

  await logAudit({
    action: "user.banned",
    resourceType: "user",
    resourceId: after.id,
    before: { banned: before.banned, banReason: before.banReason },
    after: {
      banned: after.banned,
      banReason: after.banReason,
      banExpires: after.banExpires?.toISOString() ?? null,
    },
  });

  await invalidateUser(after.id);
  return after;
}

async function unban(input: unknown): Promise<UserListItem> {
  await requirePermission("user", "ban");
  const { id } = userIdSchema.parse(input);

  const before = await usersRepository.findById(id);
  if (!before) throw new NotFoundError("User", id);

  await auth.api.unbanUser({
    body: { userId: id },
    headers: await headers(),
  });

  const after = await usersRepository.findById(id);
  if (!after) throw new NotFoundError("User", id);

  await logAudit({
    action: "user.unbanned",
    resourceType: "user",
    resourceId: id,
    before: { banned: before.banned, banReason: before.banReason },
    after: { banned: after.banned },
  });

  await invalidateUser(id);
  return after;
}

async function remove(input: unknown): Promise<void> {
  const actor = await requirePermission("user", "delete");
  const { id } = userIdSchema.parse(input);

  if (id === actor.user.id) {
    throw new BadRequestError("You cannot delete your own account here.");
  }

  const before = await usersRepository.findById(id);
  if (!before) throw new NotFoundError("User", id);

  await assertNotProtected(actor, before, "delete");

  await auth.api.removeUser({
    body: { userId: id },
    headers: await headers(),
  });

  await logAudit({
    action: "user.deleted",
    resourceType: "user",
    resourceId: id,
    before: snapshot(before),
  });

  await invalidateUser(id);
}

async function setPassword(input: unknown): Promise<void> {
  await requirePermission("user", "set-password");
  const values = setPasswordSchema.parse(input);

  const user = await usersRepository.findById(values.id);
  if (!user) throw new NotFoundError("User", values.id);

  await auth.api.setUserPassword({
    body: { userId: values.id, newPassword: values.password },
    headers: await headers(),
  });

  await logAudit({
    action: "user.password_set",
    resourceType: "user",
    resourceId: values.id,
    // Never record the password, not even its length.
    after: { by: "admin" },
  });
}

async function revokeSessions(input: unknown): Promise<void> {
  await requirePermission("session", "revoke");
  const { id } = userIdSchema.parse(input);

  const user = await usersRepository.findById(id);
  if (!user) throw new NotFoundError("User", id);

  await auth.api.revokeUserSessions({
    body: { userId: id },
    headers: await headers(),
  });

  await logAudit({
    action: "user.sessions_revoked",
    resourceType: "session",
    resourceId: id,
    after: { userId: id },
  });

  await invalidateUser(id);
}

async function impersonate(input: unknown): Promise<void> {
  const actor = await requirePermission("user", "impersonate");
  const { id } = userIdSchema.parse(input);

  const target = await usersRepository.findById(id);
  if (!target) throw new NotFoundError("User", id);

  // Impersonating another admin is a privilege-escalation path: it hands you
  // their permissions under their identity.
  const targetIsAdmin = await hasPrivilegedRole(target.roleKeys);
  if (targetIsAdmin && !actor.permissionKeys.has("user:impersonate-admins")) {
    throw new ForbiddenError(
      "You cannot impersonate a user with administrative privileges.",
    );
  }

  await auth.api.impersonateUser({
    body: { userId: id },
    headers: await headers(),
  });

  await logAudit({
    action: "user.impersonation_started",
    resourceType: "user",
    resourceId: id,
    after: { targetEmail: target.email },
  });
}

async function bulkBan(input: unknown, reason: string): Promise<number> {
  await requirePermission("user", "ban");
  const { ids } = bulkUserActionSchema.parse(input);

  let banned = 0;
  for (const id of ids) {
    try {
      await ban({ id, reason });
      banned += 1;
    } catch {
      // One failure (self-ban, protected target) must not abort the rest;
      // the per-user audit entries record exactly what did happen.
    }
  }
  return banned;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * You may only assign roles whose permissions you already hold.
 *
 * Without this, `role:assign` is equivalent to `*`: assign yourself a role that
 * grants everything and you're a super-admin.
 */
async function assertRoleAssignable(
  actor: Awaited<ReturnType<typeof requirePermission>>,
  roleKeys: string[],
): Promise<void> {
  if (roleKeys.length === 0) return;

  const roles = await rbacRepository.findRolesByKeys(roleKeys);
  const found = new Set(roles.map((role) => role.key));
  const missing = roleKeys.filter((key) => !found.has(key));
  if (missing.length > 0) {
    throw new BadRequestError(`Unknown role: ${missing.join(", ")}`);
  }

  const granted = await rbacRepository.findPermissionKeysForRoleKeys(roleKeys);
  assertNoPrivilegeEscalation(actor, granted);
}

/** Refuses destructive actions against users who outrank the actor. */
async function assertNotProtected(
  actor: Awaited<ReturnType<typeof requirePermission>>,
  target: UserListItem,
  action: string,
): Promise<void> {
  const targetPermissions = await rbacRepository.findPermissionKeysForRoleKeys(
    target.roleKeys,
  );

  const beyondActor = targetPermissions.filter(
    (key) => !actor.permissionKeys.has(key),
  );

  if (beyondActor.length > 0) {
    throw new ForbiddenError(
      `You cannot ${action} a user who holds permissions you don't: ${beyondActor.join(", ")}`,
    );
  }
}

async function hasPrivilegedRole(roleKeys: string[]): Promise<boolean> {
  if (roleKeys.length === 0) return false;
  const permissions =
    await rbacRepository.findPermissionKeysForRoleKeys(roleKeys);
  return permissions.some(
    (key) => key.startsWith("role:") || key === "user:set-role",
  );
}

async function invalidateUser(userId: string): Promise<void> {
  await invalidateUserPermissions(userId);
  invalidateQueryTags(cacheTags.users);
}

function snapshot(user: UserListItem): Record<string, unknown> {
  return {
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    roleKeys: user.roleKeys,
    banned: user.banned,
  };
}

export const usersService = {
  list,
  findById,
  getStats,
  listSessions,
  create,
  update,
  assignRoles,
  ban,
  unban,
  remove,
  setPassword,
  revokeSessions,
  impersonate,
  bulkBan,
};

export type { UserListItem };
