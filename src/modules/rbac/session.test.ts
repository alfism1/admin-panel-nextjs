import { describe, expect, it } from "vitest";

import { isImpersonating, roleKeysOf, type AuthSession } from "./session";

/**
 * `users.role` is Better-Auth's comma-separated string. Every authorisation
 * decision starts by parsing it, so the edge cases matter: a stray space or
 * trailing comma must not produce a phantom role key that matches nothing.
 */
describe("roleKeysOf", () => {
  const user = (role: unknown) =>
    ({ id: "u1", role }) as Parameters<typeof roleKeysOf>[0];

  it("parses a single role", () => {
    expect(roleKeysOf(user("admin"))).toEqual(["admin"]);
  });

  it("parses several roles", () => {
    expect(roleKeysOf(user("admin,viewer"))).toEqual(["admin", "viewer"]);
  });

  it("trims whitespace around each key", () => {
    expect(roleKeysOf(user(" admin , viewer "))).toEqual(["admin", "viewer"]);
  });

  it("drops empty segments from a trailing or doubled comma", () => {
    expect(roleKeysOf(user("admin,,viewer,"))).toEqual(["admin", "viewer"]);
  });

  it("returns nothing for null, empty, or whitespace", () => {
    expect(roleKeysOf(user(null))).toEqual([]);
    expect(roleKeysOf(user(""))).toEqual([]);
    expect(roleKeysOf(user("   "))).toEqual([]);
  });

  it("returns nothing for a non-string value", () => {
    expect(roleKeysOf(user(42))).toEqual([]);
    expect(roleKeysOf(user(undefined))).toEqual([]);
  });
});

describe("isImpersonating", () => {
  const session = (impersonatedBy: string | null) =>
    ({ session: { impersonatedBy } }) as unknown as AuthSession;

  it("is true when the session records an impersonator", () => {
    expect(isImpersonating(session("admin-1"))).toBe(true);
  });

  it("is false for a normal session", () => {
    expect(isImpersonating(session(null))).toBe(false);
  });

  it("is false when there is no session", () => {
    expect(isImpersonating(null)).toBe(false);
  });
});
