import { describe, expect, it } from "vitest";

import {
  ALL_PERMISSION_KEYS,
  RESOURCES,
  SYSTEM_ROLES,
  findUndeclaredDefaultActions,
  grantsToPermissionKeys,
  isResource,
  parsePermissionKey,
  permissionKey,
  statement,
} from "./permissions";

describe("access-control statement", () => {
  it("declares every action Better-Auth's admin plugin authorises against", () => {
    // A Better-Auth upgrade adding a default action we don't declare would make
    // its /api/auth/admin/* endpoints unauthorisable, and fail silently.
    expect(findUndeclaredDefaultActions()).toEqual([]);
  });

  it("enumerates one key per (resource, action) pair", () => {
    const expected = RESOURCES.reduce(
      (total, resource) => total + statement[resource].length,
      0,
    );
    expect(ALL_PERMISSION_KEYS).toHaveLength(expected);
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(expected);
  });

  it("round-trips a key through build and parse", () => {
    const key = permissionKey("user", "ban");
    expect(key).toBe("user:ban");
    expect(parsePermissionKey(key)).toEqual({
      resource: "user",
      action: "ban",
    });
  });

  it("rejects keys outside the statement", () => {
    expect(parsePermissionKey("user:launch-missiles")).toBeNull();
    expect(parsePermissionKey("spaceship:read")).toBeNull();
    expect(parsePermissionKey("nonsense")).toBeNull();
    expect(parsePermissionKey(":read")).toBeNull();
  });

  it("parses actions containing a hyphen", () => {
    expect(parsePermissionKey("user:set-role")).toEqual({
      resource: "user",
      action: "set-role",
    });
  });

  it("narrows resource strings", () => {
    expect(isResource("user")).toBe(true);
    expect(isResource("toString")).toBe(false);
  });
});

describe("system roles", () => {
  const byKey = new Map(SYSTEM_ROLES.map((role) => [role.key, role]));

  it("grants super_admin every declared permission", () => {
    const granted = grantsToPermissionKeys(byKey.get("super_admin")!.grants);
    expect(new Set(granted)).toEqual(new Set(ALL_PERMISSION_KEYS));
  });

  it("never lets admin edit roles — that is a self-promotion path", () => {
    const granted = grantsToPermissionKeys(byKey.get("admin")!.grants);
    expect(granted).not.toContain("role:create");
    expect(granted).not.toContain("role:update");
    expect(granted).not.toContain("role:delete");
    expect(granted).not.toContain("role:assign");
    expect(granted).toContain("role:read");
  });

  it("never lets admin impersonate another admin", () => {
    const granted = grantsToPermissionKeys(byKey.get("admin")!.grants);
    expect(granted).not.toContain("user:impersonate-admins");
    expect(granted).toContain("user:impersonate");
  });

  it("gives viewer read access and nothing else", () => {
    const granted = grantsToPermissionKeys(byKey.get("viewer")!.grants);
    const writeActions = granted.filter((key) => {
      const action = key.split(":")[1] ?? "";
      return !["read", "list", "get"].includes(action);
    });
    expect(writeActions).toEqual([]);
  });

  it("forces two-factor on super_admin", () => {
    // The account that can grant itself anything is the one worth protecting.
    expect(byKey.get("super_admin")!.requireTwoFactor).toBe(true);
  });

  it("only grants permissions that exist in the statement", () => {
    for (const role of SYSTEM_ROLES) {
      for (const key of grantsToPermissionKeys(role.grants)) {
        expect(
          parsePermissionKey(key),
          `${role.key} grants ${key}`,
        ).not.toBeNull();
      }
    }
  });
});
