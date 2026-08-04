import { beforeEach, describe, expect, it, vi } from "vitest";

import { BadRequestError, ForbiddenError, NotFoundError } from "@/lib/errors";

import { usersRepository } from "./users.repository";
import { usersService } from "./users.service";
import type * as PermissionsService from "@/modules/rbac/permissions.service";
import type { Authorization } from "@/modules/rbac/permissions.service";

vi.mock("./users.repository", () => ({
  usersRepository: {
    list: vi.fn(),
    findById: vi.fn(),
    findByEmail: vi.fn(),
    updateProfile: vi.fn(),
    setRoles: vi.fn(),
    listActiveSessions: vi.fn(),
    stats: vi.fn(),
  },
}));

vi.mock("@/modules/rbac/rbac.repository", () => ({
  rbacRepository: {
    findRolesByKeys: vi.fn(),
    findPermissionKeysForRoleKeys: vi.fn(),
  },
}));

vi.mock("@/modules/audit-log/audit-log.service", () => ({ logAudit: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      signUpEmail: vi.fn(),
      banUser: vi.fn(),
      unbanUser: vi.fn(),
      removeUser: vi.fn(),
      setUserPassword: vi.fn(),
      revokeUserSessions: vi.fn(),
      impersonateUser: vi.fn(),
    },
  },
}));

const requirePermission = vi.hoisted(() => vi.fn());
const invalidateUserPermissions = vi.hoisted(() => vi.fn());

/**
 * Only the two functions that need a session or Redis are stubbed.
 * `assertNoPrivilegeEscalation` is left real on purpose — it is the guard these
 * tests exist to verify, and mocking it would make them assert nothing.
 */
vi.mock("@/modules/rbac/permissions.service", async (importOriginal) => {
  const actual = await importOriginal<typeof PermissionsService>();
  return { ...actual, requirePermission, invalidateUserPermissions };
});

const repo = vi.mocked(usersRepository);
const { rbacRepository } = await import("@/modules/rbac/rbac.repository");
const rbacRepo = vi.mocked(rbacRepository);
const { logAudit } = await import("@/modules/audit-log/audit-log.service");
const { auth } = await import("@/lib/auth");

function actor(permissionKeys: string[], id = "actor-1"): Authorization {
  const set = new Set(permissionKeys);
  return {
    session: {} as Authorization["session"],
    user: { id } as Authorization["user"],
    roleKeys: ["admin"],
    permissionKeys: set,
    has: (key) => set.has(key),
  };
}

const target = {
  id: "user-2",
  name: "Alan Turing",
  email: "alan@example.com",
  emailVerified: true,
  image: null,
  roleKeys: ["viewer"],
  banned: false,
  banReason: null,
  banExpires: null,
  twoFactorEnabled: false,
  createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue(
    actor(["user:ban", "user:delete", "role:assign", "user:impersonate"]),
  );
  repo.findById.mockResolvedValue(target);
  rbacRepo.findPermissionKeysForRoleKeys.mockResolvedValue([]);
  rbacRepo.findRolesByKeys.mockResolvedValue([]);
});

describe("usersService.ban", () => {
  it("bans and audits", async () => {
    await usersService.ban({ id: "user-2", reason: "spam" });

    expect(auth.api.banUser).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ userId: "user-2", banReason: "spam" }),
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.banned", resourceId: "user-2" }),
    );
  });

  it("converts an expiry in days to seconds", async () => {
    await usersService.ban({ id: "user-2", reason: "spam", expiresInDays: 7 });

    expect(auth.api.banUser).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ banExpiresIn: 7 * 24 * 60 * 60 }),
      }),
    );
  });

  it("refuses self-ban", async () => {
    // Locking yourself out is never the intent.
    await expect(
      usersService.ban({ id: "actor-1", reason: "oops" }),
    ).rejects.toThrow(BadRequestError);
    expect(auth.api.banUser).not.toHaveBeenCalled();
  });

  it("refuses to ban someone holding permissions the actor lacks", async () => {
    rbacRepo.findPermissionKeysForRoleKeys.mockResolvedValue([
      "role:create",
      "user:delete",
    ]);
    requirePermission.mockResolvedValue(actor(["user:ban"]));

    await expect(
      usersService.ban({ id: "user-2", reason: "spam" }),
    ).rejects.toThrow(ForbiddenError);
    expect(auth.api.banUser).not.toHaveBeenCalled();
  });

  it("404s for an unknown user", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(
      usersService.ban({ id: "ghost", reason: "spam" }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("usersService.remove", () => {
  it("refuses to delete yourself", async () => {
    await expect(usersService.remove({ id: "actor-1" })).rejects.toThrow(
      BadRequestError,
    );
  });

  it("refuses to delete a more privileged user", async () => {
    rbacRepo.findPermissionKeysForRoleKeys.mockResolvedValue(["role:create"]);
    requirePermission.mockResolvedValue(actor(["user:delete"]));

    await expect(usersService.remove({ id: "user-2" })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("deletes and audits the prior state", async () => {
    await usersService.remove({ id: "user-2" });

    expect(auth.api.removeUser).toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.deleted",
        before: expect.objectContaining({ email: "alan@example.com" }),
      }),
    );
  });
});

describe("usersService.assignRoles", () => {
  it("assigns and audits the role transition", async () => {
    rbacRepo.findRolesByKeys.mockResolvedValue([
      { key: "admin" } as Awaited<
        ReturnType<typeof rbacRepository.findRolesByKeys>
      >[number],
    ]);
    repo.findById
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce({ ...target, roleKeys: ["admin"] });

    await usersService.assignRoles({ id: "user-2", roleKeys: ["admin"] });

    expect(repo.setRoles).toHaveBeenCalledWith("user-2", ["admin"]);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.role_changed",
        before: { roleKeys: ["viewer"] },
        after: { roleKeys: ["admin"] },
      }),
    );
  });

  it("rejects an unknown role key", async () => {
    rbacRepo.findRolesByKeys.mockResolvedValue([]);

    await expect(
      usersService.assignRoles({ id: "user-2", roleKeys: ["does-not-exist"] }),
    ).rejects.toThrow(BadRequestError);
  });

  it("refuses to assign a role granting more than the actor holds", async () => {
    rbacRepo.findRolesByKeys.mockResolvedValue([
      { key: "super_admin" } as Awaited<
        ReturnType<typeof rbacRepository.findRolesByKeys>
      >[number],
    ]);
    rbacRepo.findPermissionKeysForRoleKeys.mockResolvedValue(["role:create"]);
    requirePermission.mockResolvedValue(actor(["role:assign"]));

    await expect(
      usersService.assignRoles({ id: "user-2", roleKeys: ["super_admin"] }),
    ).rejects.toThrow(ForbiddenError);
    expect(repo.setRoles).not.toHaveBeenCalled();
  });

  it("refuses to strip your own last role", async () => {
    await expect(
      usersService.assignRoles({ id: "actor-1", roleKeys: [] }),
    ).rejects.toThrow(BadRequestError);
  });

  it("invalidates the target's cached permissions", async () => {
    repo.findById
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce({ ...target, roleKeys: [] });

    await usersService.assignRoles({ id: "user-2", roleKeys: [] });

    expect(invalidateUserPermissions).toHaveBeenCalledWith("user-2");
  });
});

describe("usersService.impersonate", () => {
  it("refuses to impersonate an admin without impersonate-admins", async () => {
    // Impersonation hands you their permissions under their identity.
    rbacRepo.findPermissionKeysForRoleKeys.mockResolvedValue(["role:update"]);
    requirePermission.mockResolvedValue(actor(["user:impersonate"]));

    await expect(usersService.impersonate({ id: "user-2" })).rejects.toThrow(
      ForbiddenError,
    );
    expect(auth.api.impersonateUser).not.toHaveBeenCalled();
  });

  it("allows impersonating a non-privileged user", async () => {
    rbacRepo.findPermissionKeysForRoleKeys.mockResolvedValue(["user:read"]);
    requirePermission.mockResolvedValue(actor(["user:impersonate"]));

    await usersService.impersonate({ id: "user-2" });

    expect(auth.api.impersonateUser).toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.impersonation_started" }),
    );
  });

  it("allows impersonating an admin when the actor holds impersonate-admins", async () => {
    rbacRepo.findPermissionKeysForRoleKeys.mockResolvedValue(["role:update"]);
    requirePermission.mockResolvedValue(
      actor(["user:impersonate", "user:impersonate-admins"]),
    );

    await expect(
      usersService.impersonate({ id: "user-2" }),
    ).resolves.toBeUndefined();
  });
});

describe("usersService.setPassword", () => {
  it("never records the password in the audit log", async () => {
    await usersService.setPassword({
      id: "user-2",
      password: "hunter2hunter2",
    });

    const call = vi.mocked(logAudit).mock.calls.at(-1)?.[0];
    expect(JSON.stringify(call)).not.toContain("hunter2");
    expect(call).toMatchObject({ action: "user.password_set" });
  });
});

describe("usersService.bulkBan", () => {
  it("keeps going when one target is refused", async () => {
    // A self-ban or a protected target must not abort the rest of the batch.
    await usersService.bulkBan(
      { ids: ["actor-1", "user-2"] },
      "Bulk ban from the users table",
    );

    expect(auth.api.banUser).toHaveBeenCalledTimes(1);
  });
});
