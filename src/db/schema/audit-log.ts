import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Append-only audit trail.
 *
 * Deliberately denormalised: `actorEmail` is copied in rather than joined, so
 * the record still reads correctly after the actor is deleted or renamed. For
 * the same reason `actorId` has **no** foreign key — deleting a user must never
 * cascade away the evidence of what they did.
 *
 * `before`/`after` hold whole-entity snapshots as JSON. The UI diffs them
 * client-side, which keeps this table free of schema knowledge about the
 * entities it records.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),

    /** Null for system-initiated actions (cron, migrations, seeds). */
    actorId: text("actor_id"),
    actorEmail: text("actor_email"),

    /** Dotted verb, e.g. `user.banned`, `role.permissions_updated`. */
    action: text("action").notNull(),
    /** e.g. `user`, `role`, `featureFlag`, `session`. */
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),

    /**
     * `jsonb` is the one Postgres-specific type in the schema — it buys
     * indexable containment queries. On MySQL/SQLite swap for `json`/`text`;
     * nothing outside this file depends on the distinction.
     */
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),

    ip: text("ip"),
    userAgent: text("user_agent"),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Descending: the UI reads newest-first, always.
    index("audit_logs_created_at_idx").on(table.createdAt.desc()),
    index("audit_logs_actor_id_idx").on(table.actorId),
    index("audit_logs_action_idx").on(table.action),
    index("audit_logs_resource_idx").on(table.resourceType, table.resourceId),
  ],
);

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type NewAuditLogRow = typeof auditLogs.$inferInsert;
