import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Targeting rules stored in `feature_flags.rules`.
 *
 * Evaluation order is fixed and lives in `modules/feature-flags`: a disabled
 * flag is off for everyone; otherwise the first matching allow/deny rule wins,
 * then percentage rollout, then the flag's own `enabled` value.
 */
export interface FeatureFlagRules {
  /** 0–100. Deterministic per user via a hash of `${key}:${userId}`. */
  rolloutPercentage?: number;
  /** User ids the flag is forced ON for, regardless of rollout. */
  includeUserIds?: string[];
  /** User ids the flag is forced OFF for. Beats every other rule. */
  excludeUserIds?: string[];
  /** Role keys the flag is forced ON for. */
  includeRoles?: string[];
}

export const featureFlags = pgTable(
  "feature_flags",
  {
    id: text("id").primaryKey(),
    /** Stable identifier used in code: `isFeatureEnabled("new-billing")`. */
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    enabled: boolean("enabled").notNull().default(false),

    rules: jsonb("rules").$type<FeatureFlagRules>().notNull().default({}),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("feature_flags_key_unique").on(table.key),
    index("feature_flags_enabled_idx").on(table.enabled),
  ],
);

export type FeatureFlagRow = typeof featureFlags.$inferSelect;
export type NewFeatureFlagRow = typeof featureFlags.$inferInsert;
