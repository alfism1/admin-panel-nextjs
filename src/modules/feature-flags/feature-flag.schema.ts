import { z } from "zod";

/**
 * Flag keys are used verbatim in code (`isFeatureEnabled("new-billing")`), so
 * they're constrained to a shape that's safe in a URL, a Redis key and a
 * TypeScript string literal.
 */
export const flagKeySchema = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters.")
  .max(64, "Use at most 64 characters.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Lowercase letters, digits and single hyphens only (e.g. new-billing).",
  );

export const featureFlagRulesSchema = z.object({
  rolloutPercentage: z.coerce.number().int().min(0).max(100).optional(),
  includeUserIds: z.array(z.string().trim().min(1)).max(500).optional(),
  excludeUserIds: z.array(z.string().trim().min(1)).max(500).optional(),
  includeRoles: z.array(z.string().trim().min(1)).max(50).optional(),
});

export const createFeatureFlagSchema = z.object({
  key: flagKeySchema,
  name: z.string().trim().min(1, "Name is required.").max(120),
  description: z.string().trim().max(500).optional(),
  enabled: z.boolean(),
  rules: featureFlagRulesSchema,
});
export type CreateFeatureFlagInput = z.infer<typeof createFeatureFlagSchema>;

export const updateFeatureFlagSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required.").max(120),
  description: z.string().trim().max(500).optional(),
  enabled: z.boolean(),
  rules: featureFlagRulesSchema,
});
export type UpdateFeatureFlagInput = z.infer<typeof updateFeatureFlagSchema>;

export const toggleFeatureFlagSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});
export type ToggleFeatureFlagInput = z.infer<typeof toggleFeatureFlagSchema>;

export const deleteFeatureFlagSchema = z.object({ id: z.string().min(1) });

export const evaluateFlagsSchema = z.object({
  keys: z.array(flagKeySchema).min(1).max(50),
});
export type EvaluateFlagsInput = z.infer<typeof evaluateFlagsSchema>;

/**
 * The form edits comma/newline-separated text areas; this normalises them into
 * the arrays the rules object stores.
 */
export function parseIdList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? [...new Set(items)] : undefined;
}
