import { randomUUID } from "node:crypto";

/**
 * Primary keys are generated in application code, not by the database.
 *
 * Two reasons: it keeps the schema free of `gen_random_uuid()` (Postgres-only,
 * which would break the "swap the dialect" promise), and it lets a service know
 * an entity's id before the INSERT — needed to write an audit-log entry and the
 * row it describes inside one transaction.
 */
export function newId(): string {
  return randomUUID();
}
