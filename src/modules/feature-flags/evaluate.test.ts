import { describe, expect, it } from "vitest";

import { bucketFor, evaluateFlag } from "./evaluate";

/**
 * Flag evaluation decides who sees what, so these tests pin down the
 * *precedence* between rules, not just the happy path. A regression here is
 * silent: the flag still "works", it's just on for the wrong people.
 */
describe("evaluateFlag", () => {
  const user = { userId: "user-1", roleKeys: ["viewer"] };

  it("is off for everyone when the flag is disabled", () => {
    expect(evaluateFlag("f", { enabled: false, rules: {} }, user)).toEqual({
      enabled: false,
      reason: "flag-disabled",
    });
  });

  it("keeps the kill switch above every allow rule", () => {
    const result = evaluateFlag(
      "f",
      {
        enabled: false,
        rules: {
          rolloutPercentage: 100,
          includeUserIds: ["user-1"],
          includeRoles: ["viewer"],
        },
      },
      user,
    );
    expect(result).toEqual({ enabled: false, reason: "flag-disabled" });
  });

  it("is on for everyone when enabled with no rules", () => {
    expect(evaluateFlag("f", { enabled: true, rules: {} }, user)).toEqual({
      enabled: true,
      reason: "flag-enabled",
    });
  });

  it("lets an explicit exclude beat an explicit include", () => {
    const result = evaluateFlag(
      "f",
      {
        enabled: true,
        rules: { includeUserIds: ["user-1"], excludeUserIds: ["user-1"] },
      },
      user,
    );
    expect(result).toEqual({ enabled: false, reason: "user-excluded" });
  });

  it("lets an explicit exclude beat a 100% rollout", () => {
    const result = evaluateFlag(
      "f",
      {
        enabled: true,
        rules: { rolloutPercentage: 100, excludeUserIds: ["user-1"] },
      },
      user,
    );
    expect(result).toEqual({ enabled: false, reason: "user-excluded" });
  });

  it("lets an explicit include beat a 0% rollout", () => {
    const result = evaluateFlag(
      "f",
      {
        enabled: true,
        rules: { rolloutPercentage: 0, includeUserIds: ["user-1"] },
      },
      user,
    );
    expect(result).toEqual({ enabled: true, reason: "user-included" });
  });

  it("matches on role", () => {
    const result = evaluateFlag(
      "f",
      { enabled: true, rules: { includeRoles: ["admin", "viewer"] } },
      user,
    );
    expect(result).toEqual({ enabled: true, reason: "role-included" });
  });

  it("is off for someone outside a targeted role, even though enabled", () => {
    // The trap this guards: "staff only" must not mean "everyone".
    const result = evaluateFlag(
      "f",
      { enabled: true, rules: { includeRoles: ["admin"] } },
      user,
    );
    expect(result).toEqual({ enabled: false, reason: "rollout-excluded" });
  });

  it("treats a 100% rollout as on and 0% as off", () => {
    expect(
      evaluateFlag(
        "f",
        { enabled: true, rules: { rolloutPercentage: 100 } },
        user,
      ).enabled,
    ).toBe(true);
    expect(
      evaluateFlag(
        "f",
        { enabled: true, rules: { rolloutPercentage: 0 } },
        user,
      ).enabled,
    ).toBe(false);
  });

  it("is off for anonymous visitors under a partial rollout", () => {
    // No stable identity to bucket on; a coin flip per page load is worse.
    const result = evaluateFlag(
      "f",
      { enabled: true, rules: { rolloutPercentage: 50 } },
      { userId: null },
    );
    expect(result).toEqual({ enabled: false, reason: "rollout-excluded" });
  });

  it("clamps out-of-range percentages instead of throwing", () => {
    expect(
      evaluateFlag(
        "f",
        { enabled: true, rules: { rolloutPercentage: 500 } },
        user,
      ).enabled,
    ).toBe(true);
    expect(
      evaluateFlag(
        "f",
        { enabled: true, rules: { rolloutPercentage: -20 } },
        user,
      ).enabled,
    ).toBe(false);
  });

  it("returns the same answer for the same user every time", () => {
    const flag = { enabled: true, rules: { rolloutPercentage: 50 } };
    const first = evaluateFlag("f", flag, user);
    for (let i = 0; i < 50; i += 1) {
      expect(evaluateFlag("f", flag, user)).toEqual(first);
    }
  });
});

describe("bucketFor", () => {
  it("is deterministic", () => {
    expect(bucketFor("flag", "user")).toBe(bucketFor("flag", "user"));
  });

  it("stays within [0, 100)", () => {
    for (let i = 0; i < 1_000; i += 1) {
      const bucket = bucketFor("flag", `user-${i}`);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    }
  });

  it("puts the same user in different buckets for different flags", () => {
    // Otherwise the same unlucky cohort is enrolled in every experiment.
    const a = bucketFor("flag-a", "user-1");
    const b = bucketFor("flag-b", "user-1");
    expect(a).not.toBe(b);
  });

  it("distributes roughly evenly, so a 25% rollout hits ~25%", () => {
    const total = 10_000;
    let included = 0;
    for (let i = 0; i < total; i += 1) {
      if (bucketFor("rollout", `user-${i}`) < 25) included += 1;
    }
    const ratio = included / total;
    // Generous bounds: this asserts the hash isn't skewed, not that it's
    // cryptographically uniform.
    expect(ratio).toBeGreaterThan(0.22);
    expect(ratio).toBeLessThan(0.28);
  });
});
