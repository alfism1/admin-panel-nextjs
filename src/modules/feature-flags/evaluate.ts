import type { FeatureFlagRules } from "@/db/schema";

/**
 * Flag evaluation — pure, dependency-free, isomorphic.
 *
 * No I/O and no Node built-ins on purpose. This is the part that decides who
 * sees what, so it must be trivially testable *and* produce identical answers
 * on the server and in the browser — the admin UI's "who is this on for?"
 * preview runs this exact function client-side.
 */

export interface EvaluationContext {
  userId?: string | null;
  roleKeys?: string[];
}

export type EvaluationReason =
  | "flag-disabled"
  | "user-excluded"
  | "user-included"
  | "role-included"
  | "rollout-included"
  | "rollout-excluded"
  | "flag-enabled";

export interface EvaluationResult {
  enabled: boolean;
  reason: EvaluationReason;
}

/**
 * Precedence, highest first:
 *
 *  1. `enabled: false` — a killed flag is off for everyone. This is the kill
 *     switch, so nothing may override it.
 *  2. `excludeUserIds` — an explicit deny beats every allow.
 *  3. `includeUserIds` / `includeRoles` — explicit allow beats the rollout.
 *  4. `rolloutPercentage` — deterministic per user.
 *  5. otherwise: the flag's own `enabled`.
 */
export function evaluateFlag(
  key: string,
  flag: { enabled: boolean; rules: FeatureFlagRules },
  context: EvaluationContext = {},
): EvaluationResult {
  if (!flag.enabled) return { enabled: false, reason: "flag-disabled" };

  const rules = flag.rules ?? {};
  const userId = context.userId ?? null;

  if (userId && rules.excludeUserIds?.includes(userId)) {
    return { enabled: false, reason: "user-excluded" };
  }

  if (userId && rules.includeUserIds?.includes(userId)) {
    return { enabled: true, reason: "user-included" };
  }

  if (rules.includeRoles?.length && context.roleKeys?.length) {
    const matches = context.roleKeys.some((role) =>
      rules.includeRoles?.includes(role),
    );
    if (matches) return { enabled: true, reason: "role-included" };
  }

  if (typeof rules.rolloutPercentage === "number") {
    const percentage = clampPercentage(rules.rolloutPercentage);
    if (percentage >= 100) return { enabled: true, reason: "rollout-included" };
    if (percentage <= 0) return { enabled: false, reason: "rollout-excluded" };

    // Anonymous visitors have no stable identity to bucket on. Putting them all
    // in the "off" group is the honest answer — the alternative is a coin flip
    // that changes on every page load.
    if (!userId) return { enabled: false, reason: "rollout-excluded" };

    const bucket = bucketFor(key, userId);
    return bucket < percentage
      ? { enabled: true, reason: "rollout-included" }
      : { enabled: false, reason: "rollout-excluded" };
  }

  // A flag targeting specific users/roles is off for everyone else, even when
  // `enabled` is true — otherwise "staff only" would mean "everyone".
  if (rules.includeUserIds?.length || rules.includeRoles?.length) {
    return { enabled: false, reason: "rollout-excluded" };
  }

  return { enabled: true, reason: "flag-enabled" };
}

/**
 * Stable bucket in `[0, 100)` for a (flag, user) pair.
 *
 * Hashing the key *together with* the user id means two 30% flags don't roll
 * out to the same 30% of people — otherwise the same unlucky cohort gets every
 * experiment. Deterministic, so a user's experience doesn't flicker between
 * requests.
 *
 * FNV-1a rather than SHA-256: bucketing needs even distribution, not collision
 * resistance, and a plain integer hash keeps this module free of `node:crypto`
 * so it can run unchanged in the browser.
 */
export function bucketFor(key: string, userId: string): number {
  const input = `${key}:${userId}`;

  // FNV-1a, 32-bit. `Math.imul` keeps the multiply in 32-bit integer space.
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  // >>> 0 reinterprets the signed result as unsigned.
  return ((hash >>> 0) % 10_000) / 100;
}

function clampPercentage(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
