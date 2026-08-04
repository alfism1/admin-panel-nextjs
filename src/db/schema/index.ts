/**
 * Schema barrel — one file per domain, re-exported here.
 *
 * `drizzle.config.ts` and `src/db/client.ts` both point at this file, so a new
 * domain becomes visible to migrations and to the query builder by adding a
 * single line below.
 */
export * from "./auth";
export * from "./rbac";
export * from "./audit-log";
export * from "./feature-flags";
