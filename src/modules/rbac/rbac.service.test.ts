import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/errors";

import type * as PermissionsService from "./permissions.service";
import { rbacRepository } from "./rbac.repository";
import { rbacService } from "./rbac.service";
import type { Authorization } from "./permissions.service";

vi.mock("./rbac.repository", () => ({
  rbacRepository: {
    listRoles: vi.fn(),
    listRolesWithPermissions: vi.fn(),
    findRoleById: vi.fn(),
    findRolesByKeys: vi.fn(),
    findPermissionKeysForRoleKeys: vi.fn(),
    listPermissions: vi.fn(),
    isKeyTaken: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    deleteRole: vi.fn(),
    replaceRolePermissions: vi.fn(),
    countUsersWithRoleKey: vi.fn(),
  },
}));

vi.mock("@/modules/audit-log/audit-log.service", () => ({
  logAudit: vi.fn(),
}));

const requirePermission = vi.hoisted(() => vi.fn());
const invalidateAllPermissions = vi.hoisted(() => vi.fn());

vi.mock("./permissions.service", async (importOriginal) => {
  const actual = await importOriginal<typeof PermissionsService>();
  return {
    ...actual,
    requirePermission,
    invalidateAllPermissions,
  };
});

const repo = vi.mocked(rbacRepository);
const { logAudit } = await import("@/modules/audit-log/audit-log.service");

/** An actor holding exactly `permissionKeys`. */
function actor(
  permissionKeys: string[],
  roleKeys: string[] = [],
): Authorization {
  const set = new Set(permissionKeys);
  return {
    session: {} as Authorization["session"],
    user: { id: "actor-1" } as Authorization["user"],
    roleKeys,
    permissionKeys: set,
    has: (key) => set.has(key),
  };
}

const systemRole = {
  id: "role-sys",
  key: "super_admin",
  name: "Super Admin",
  description: null,
  isSystem: true,
  requireTwoFactor: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const customRole = {
  ...systemRole,
  id: "role-1",
  key: "support",
  name: "Support",
  isSystem: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue(
    actor(["role:create", "role:update", "role:delete", "role:read"]),
  );
});

describe("rbacService.create", () => {
  it("creates the role and writes its grants", async () => {
    requirePermission.mockResolvedValue(
      actor(["role:create", "user:read", "user:ban"]),
    );
    repo.isKeyTaken.mockResolvedValue(false);
    repo.createRole.mockResolvedValue(customRole);

    await rbacService.create({
      key: "support",
      name: "Support",
      requireTwoFactor: false,
      permissionKeys: ["user:read", "user:ban"],
    });

    expect(repo.createRole).toHaveBeenCalledWith(
      expect.objectContaining({ key: "support", name: "Support" }),
    );
    expect(repo.replaceRolePermissions).toHaveBeenCalledWith("role-1", [
      "user:read",
      "user:ban",
    ]);
  });

  it("refuses a duplicate key", async () => {
    repo.isKeyTaken.mockResolvedValue(true);

    await expect(
      rbacService.create({
        key: "support",
        name: "Support",
        requireTwoFactor: false,
        permissionKeys: [],
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("refuses to grant a permission the author does not hold", async () => {
    // Otherwise `role:create` silently means "grant yourself anything".
    requirePermission.mockResolvedValue(actor(["role:create", "user:read"]));
    repo.isKeyTaken.mockResolvedValue(false);

    await expect(
      rbacService.create({
        key: "sneaky",
        name: "Sneaky",
        requireTwoFactor: false,
        permissionKeys: ["user:read", "user:delete"],
      }),
    ).rejects.toThrow(ForbiddenError);

    expect(repo.createRole).not.toHaveBeenCalled();
  });

  it("writes an audit entry", async () => {
    requirePermission.mockResolvedValue(actor(["role:create", "user:read"]));
    repo.isKeyTaken.mockResolvedValue(false);
    repo.createRole.mockResolvedValue(customRole);

    await rbacService.create({
      key: "support",
      name: "Support",
      requireTwoFactor: false,
      permissionKeys: ["user:read"],
    });

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "role.created", resourceType: "role" }),
    );
  });
});

describe("rbacService.updatePermissions", () => {
  const withGrants = (permissionKeys: string[], key = "support") => ({
    ...customRole,
    key,
    permissionKeys,
    memberCount: 0,
  });

  it("replaces the grants and records before/after", async () => {
    requirePermission.mockResolvedValue(
      actor(["role:update", "user:read", "user:ban"]),
    );
    repo.listRolesWithPermissions.mockResolvedValue([
      withGrants(["user:read"]),
    ]);

    await rbacService.updatePermissions({
      id: "role-1",
      permissionKeys: ["user:read", "user:ban"],
    });

    expect(repo.replaceRolePermissions).toHaveBeenCalledWith("role-1", [
      "user:read",
      "user:ban",
    ]);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "role.permissions_updated" }),
    );
  });

  it("refuses to escalate", async () => {
    requirePermission.mockResolvedValue(actor(["role:update", "user:read"]));
    repo.listRolesWithPermissions.mockResolvedValue([
      withGrants(["user:read"]),
    ]);

    await expect(
      rbacService.updatePermissions({
        id: "role-1",
        permissionKeys: ["user:read", "role:create"],
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("stops you removing your own ability to manage roles", async () => {
    // Otherwise an operator locks themselves out of the page they're on.
    requirePermission.mockResolvedValue(
      actor(["role:update", "role:read", "user:read"], ["support"]),
    );
    repo.listRolesWithPermissions.mockResolvedValue([
      withGrants(["role:update", "role:read", "user:read"]),
    ]);

    await expect(
      rbacService.updatePermissions({
        id: "role-1",
        permissionKeys: ["user:read"],
      }),
    ).rejects.toThrow(BadRequestError);
  });

  it("allows trimming a role you do not hold", async () => {
    requirePermission.mockResolvedValue(
      actor(["role:update", "role:read", "user:read"], ["super_admin"]),
    );
    repo.listRolesWithPermissions
      .mockResolvedValueOnce([withGrants(["role:update", "role:read"])])
      .mockResolvedValueOnce([withGrants([])]);

    await expect(
      rbacService.updatePermissions({ id: "role-1", permissionKeys: [] }),
    ).resolves.toBeDefined();
  });

  it("404s for an unknown role", async () => {
    repo.listRolesWithPermissions.mockResolvedValue([]);
    await expect(
      rbacService.updatePermissions({ id: "nope", permissionKeys: [] }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("rbacService.remove", () => {
  it("deletes a custom role with no members", async () => {
    repo.findRoleById.mockResolvedValue(customRole);
    repo.countUsersWithRoleKey.mockResolvedValue(0);

    await rbacService.remove({ id: "role-1" });

    expect(repo.deleteRole).toHaveBeenCalledWith("role-1");
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "role.deleted" }),
    );
  });

  it("refuses to delete a system role", async () => {
    // Deleting super_admin would lock everyone out of the panel.
    repo.findRoleById.mockResolvedValue(systemRole);

    await expect(rbacService.remove({ id: "role-sys" })).rejects.toThrow(
      BadRequestError,
    );
    expect(repo.deleteRole).not.toHaveBeenCalled();
  });

  it("refuses while users still hold the role", async () => {
    repo.findRoleById.mockResolvedValue(customRole);
    repo.countUsersWithRoleKey.mockResolvedValue(3);

    await expect(rbacService.remove({ id: "role-1" })).rejects.toThrow(
      ConflictError,
    );
    expect(repo.deleteRole).not.toHaveBeenCalled();
  });

  it("404s for an unknown role", async () => {
    repo.findRoleById.mockResolvedValue(null);
    await expect(rbacService.remove({ id: "nope" })).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("rbacService cache invalidation", () => {
  it("drops every cached permission set after a grant change", async () => {
    // A role edit changes access for everyone holding it, not just one user.
    requirePermission.mockResolvedValue(actor(["role:update", "user:read"]));
    repo.listRolesWithPermissions.mockResolvedValue([
      { ...customRole, permissionKeys: [], memberCount: 0 },
    ]);

    await rbacService.updatePermissions({
      id: "role-1",
      permissionKeys: ["user:read"],
    });

    expect(invalidateAllPermissions).toHaveBeenCalled();
  });
});
