import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import { MemoryCacheStore } from "@/modules/cache/cache-store";
import { __setCacheStoreForTests } from "@/modules/cache/cache.service";

import {
  assertNoPrivilegeEscalation,
  getPermissionKeysForUser,
  isBanned,
  type Authorization,
} from "./permissions.service";
import { rbacRepository } from "./rbac.repository";

vi.mock("./rbac.repository", () => ({
  rbacRepository: { findPermissionKeysForRoleKeys: vi.fn() },
}));

const findPermissionKeys = vi.mocked(
  rbacRepository.findPermissionKeysForRoleKeys,
);

function authorization(permissionKeys: string[]): Authorization {
  const set = new Set(permissionKeys);
  return {
    session: {} as Authorization["session"],
    user: {} as Authorization["user"],
    roleKeys: ["custom"],
    permissionKeys: set,
    has: (key) => set.has(key),
  };
}

describe("getPermissionKeysForUser", () => {
  beforeEach(() => {
    __setCacheStoreForTests(new MemoryCacheStore());
    findPermissionKeys.mockReset();
  });

  afterEach(() => {
    __setCacheStoreForTests(undefined);
  });

  it("resolves the union of every role's grants", async () => {
    findPermissionKeys.mockResolvedValue(["user:read", "role:read"]);

    const keys = await getPermissionKeysForUser("u1", ["admin", "viewer"]);

    expect(keys).toEqual(new Set(["user:read", "role:read"]));
    expect(findPermissionKeys).toHaveBeenCalledWith(["admin", "viewer"]);
  });

  it("short-circuits to empty when the user holds no roles", async () => {
    const keys = await getPermissionKeysForUser("u1", []);
    expect(keys.size).toBe(0);
    // No point querying for the grants of nothing.
    expect(findPermissionKeys).not.toHaveBeenCalled();
  });

  it("serves repeat lookups from cache", async () => {
    findPermissionKeys.mockResolvedValue(["user:read"]);

    await getPermissionKeysForUser("u1", ["viewer"]);
    await getPermissionKeysForUser("u1", ["viewer"]);
    await getPermissionKeysForUser("u1", ["viewer"]);

    expect(findPermissionKeys).toHaveBeenCalledTimes(1);
  });

  it("keeps different users on separate cache entries", async () => {
    findPermissionKeys.mockResolvedValueOnce(["user:read"]);
    findPermissionKeys.mockResolvedValueOnce(["user:read", "user:delete"]);

    const first = await getPermissionKeysForUser("u1", ["viewer"]);
    const second = await getPermissionKeysForUser("u2", ["admin"]);

    expect(first.has("user:delete")).toBe(false);
    expect(second.has("user:delete")).toBe(true);
  });
});

describe("assertNoPrivilegeEscalation", () => {
  it("allows granting a subset of what the actor holds", () => {
    const actor = authorization(["user:read", "user:ban", "role:read"]);
    expect(() =>
      assertNoPrivilegeEscalation(actor, ["user:read", "role:read"]),
    ).not.toThrow();
  });

  it("allows granting exactly what the actor holds", () => {
    const actor = authorization(["user:read", "user:ban"]);
    expect(() =>
      assertNoPrivilegeEscalation(actor, ["user:read", "user:ban"]),
    ).not.toThrow();
  });

  it("refuses to let an actor grant a permission they lack", () => {
    // Without this, `role:create` silently means "grant yourself anything".
    const actor = authorization(["user:read"]);
    expect(() =>
      assertNoPrivilegeEscalation(actor, ["user:read", "user:delete"]),
    ).toThrow(ForbiddenError);
  });

  it("names the offending permissions in the error", () => {
    const actor = authorization(["user:read"]);
    expect(() =>
      assertNoPrivilegeEscalation(actor, ["user:delete", "role:create"]),
    ).toThrow(/user:delete, role:create/);
  });

  it("allows granting nothing", () => {
    expect(() =>
      assertNoPrivilegeEscalation(authorization([]), []),
    ).not.toThrow();
  });
});

describe("isBanned", () => {
  const asUser = (value: Record<string, unknown>) =>
    value as unknown as Parameters<typeof isBanned>[0];

  it("is false for an unbanned user", () => {
    expect(isBanned(asUser({ banned: false }))).toBe(false);
  });

  it("is true for an indefinite ban", () => {
    expect(isBanned(asUser({ banned: true, banExpires: null }))).toBe(true);
  });

  it("is true while a timed ban is still running", () => {
    const future = new Date(Date.now() + 60_000);
    expect(isBanned(asUser({ banned: true, banExpires: future }))).toBe(true);
  });

  it("is false once a timed ban has elapsed", () => {
    // Better-Auth clears the flag lazily, so an expired ban is not a ban.
    const past = new Date(Date.now() - 60_000);
    expect(isBanned(asUser({ banned: true, banExpires: past }))).toBe(false);
  });

  it("accepts an ISO string expiry, as it arrives over the wire", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isBanned(asUser({ banned: true, banExpires: past }))).toBe(false);
  });
});
