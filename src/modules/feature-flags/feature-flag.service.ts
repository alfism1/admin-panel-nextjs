import "server-only";

import type { FeatureFlagRow, FeatureFlagRules } from "@/db/schema";
import { ConflictError, NotFoundError } from "@/lib/errors";
import {
  cache,
  cacheKeys,
  cacheTags,
  cacheTtl,
  invalidateQueryTags,
} from "@/modules/cache";
import { logAudit } from "@/modules/audit-log/audit-log.service";
import { requirePermission } from "@/modules/rbac/permissions.service";
import { getAuthorization } from "@/modules/rbac/permissions.service";

import {
  evaluateFlag,
  type EvaluationContext,
  type EvaluationResult,
} from "./evaluate";
import { featureFlagRepository } from "./feature-flag.repository";
import {
  createFeatureFlagSchema,
  deleteFeatureFlagSchema,
  toggleFeatureFlagSchema,
  updateFeatureFlagSchema,
} from "./feature-flag.schema";

/**
 * Feature flags.
 *
 * Read path is cache-aside over Redis (`flag:{key}`, 30s): the hot call is
 * `isFeatureEnabled()` inside a render, and it must not become a database query
 * per component. Writes invalidate the key, the list, and the Next data-cache
 * tag — see `src/modules/cache/README.md` for why all three.
 */

/** Only what evaluation needs. Keeps the cached payload small and stable. */
interface CachedFlag {
  key: string;
  enabled: boolean;
  rules: FeatureFlagRules;
}

async function loadFlag(key: string): Promise<CachedFlag | null> {
  return cache.wrap<CachedFlag | null>(
    cacheKeys.featureFlag(key),
    async () => {
      const row = await featureFlagRepository.findByKey(key);
      return row
        ? { key: row.key, enabled: row.enabled, rules: row.rules }
        : null;
    },
    {
      ttlSeconds: cacheTtl.featureFlag,
      tags: [cacheTags.featureFlags, cacheTags.featureFlag(key)],
    },
  );
}

/**
 * Server-side flag check.
 *
 * With no `context`, the current session is used — so most call sites are just
 * `await isFeatureEnabled("new-billing")`. An unknown key is `false`: a deleted
 * flag must fail closed, not resurrect a code path.
 */
export async function isFeatureEnabled(
  key: string,
  context?: EvaluationContext,
): Promise<boolean> {
  const result = await evaluate(key, context);
  return result.enabled;
}

export async function evaluate(
  key: string,
  context?: EvaluationContext,
): Promise<EvaluationResult> {
  const flag = await loadFlag(key);
  if (!flag) return { enabled: false, reason: "flag-disabled" };

  const resolved = context ?? (await ambientContext());
  return evaluateFlag(key, flag, resolved);
}

/** Evaluates several keys in one pass — used by `/api/feature-flags/evaluate`. */
export async function evaluateMany(
  keys: string[],
  context?: EvaluationContext,
): Promise<Record<string, boolean>> {
  const resolved = context ?? (await ambientContext());
  const entries = await Promise.all(
    keys.map(async (key) => {
      const flag = await loadFlag(key);
      const enabled = flag ? evaluateFlag(key, flag, resolved).enabled : false;
      return [key, enabled] as const;
    }),
  );
  return Object.fromEntries(entries);
}

async function ambientContext(): Promise<EvaluationContext> {
  const authorization = await getAuthorization();
  return authorization
    ? { userId: authorization.user.id, roleKeys: authorization.roleKeys }
    : { userId: null, roleKeys: [] };
}

// ---------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------

async function list(search = ""): Promise<FeatureFlagRow[]> {
  await requirePermission("featureFlag", "read");
  return featureFlagRepository.list(search);
}

async function findById(id: string): Promise<FeatureFlagRow> {
  await requirePermission("featureFlag", "read");
  const row = await featureFlagRepository.findById(id);
  if (!row) throw new NotFoundError("Feature flag", id);
  return row;
}

async function getStats(): Promise<{ total: number; enabled: number }> {
  return featureFlagRepository.stats();
}

/**
 * "Who is this on for?" preview.
 *
 * Evaluates the flag against a sample of real users so an operator can sanity-
 * check a rollout rule before saving it, instead of shipping and hoping.
 */
async function preview(
  flag: { key: string; enabled: boolean; rules: FeatureFlagRules },
  candidates: { id: string; email: string; roleKeys: string[] }[],
): Promise<{ id: string; email: string; enabled: boolean; reason: string }[]> {
  await requirePermission("featureFlag", "read");

  return candidates.map((candidate) => {
    const result = evaluateFlag(flag.key, flag, {
      userId: candidate.id,
      roleKeys: candidate.roleKeys,
    });
    return {
      id: candidate.id,
      email: candidate.email,
      enabled: result.enabled,
      reason: result.reason,
    };
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function invalidate(key: string): Promise<void> {
  await cache.invalidateTags(
    cacheTags.featureFlag(key),
    cacheTags.featureFlags,
  );
  invalidateQueryTags(cacheTags.featureFlags);
}

async function create(input: unknown): Promise<FeatureFlagRow> {
  await requirePermission("featureFlag", "create");
  const values = createFeatureFlagSchema.parse(input);

  if (await featureFlagRepository.isKeyTaken(values.key)) {
    throw new ConflictError(
      `A flag with the key "${values.key}" already exists.`,
    );
  }

  const row = await featureFlagRepository.insert({
    key: values.key,
    name: values.name,
    description: values.description ?? null,
    enabled: values.enabled,
    rules: values.rules,
  });

  await logAudit({
    action: "featureFlag.created",
    resourceType: "featureFlag",
    resourceId: row.key,
    after: snapshot(row),
  });

  await invalidate(row.key);
  return row;
}

async function update(input: unknown): Promise<FeatureFlagRow> {
  await requirePermission("featureFlag", "update");
  const values = updateFeatureFlagSchema.parse(input);

  const before = await featureFlagRepository.findById(values.id);
  if (!before) throw new NotFoundError("Feature flag", values.id);

  const row = await featureFlagRepository.update(values.id, {
    name: values.name,
    description: values.description ?? null,
    enabled: values.enabled,
    rules: values.rules,
  });
  if (!row) throw new NotFoundError("Feature flag", values.id);

  await logAudit({
    action: "featureFlag.updated",
    resourceType: "featureFlag",
    resourceId: row.key,
    before: snapshot(before),
    after: snapshot(row),
  });

  await invalidate(row.key);
  return row;
}

async function toggle(input: unknown): Promise<FeatureFlagRow> {
  await requirePermission("featureFlag", "toggle");
  const values = toggleFeatureFlagSchema.parse(input);

  const before = await featureFlagRepository.findById(values.id);
  if (!before) throw new NotFoundError("Feature flag", values.id);

  const row = await featureFlagRepository.update(values.id, {
    enabled: values.enabled,
  });
  if (!row) throw new NotFoundError("Feature flag", values.id);

  await logAudit({
    action: "featureFlag.toggled",
    resourceType: "featureFlag",
    resourceId: row.key,
    before: { enabled: before.enabled },
    after: { enabled: row.enabled },
  });

  await invalidate(row.key);
  return row;
}

async function remove(input: unknown): Promise<void> {
  await requirePermission("featureFlag", "delete");
  const { id } = deleteFeatureFlagSchema.parse(input);

  const before = await featureFlagRepository.findById(id);
  if (!before) throw new NotFoundError("Feature flag", id);

  await featureFlagRepository.remove(id);

  await logAudit({
    action: "featureFlag.deleted",
    resourceType: "featureFlag",
    resourceId: before.key,
    before: snapshot(before),
  });

  await invalidate(before.key);
}

function snapshot(row: FeatureFlagRow): Record<string, unknown> {
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    rules: row.rules,
  };
}

export const featureFlagService = {
  isFeatureEnabled,
  evaluate,
  evaluateMany,
  list,
  findById,
  getStats,
  preview,
  create,
  update,
  toggle,
  remove,
};
