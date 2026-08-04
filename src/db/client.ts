import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env, isProduction } from "@/lib/env";

import * as schema from "./schema";

/**
 * Drizzle client singleton.
 *
 * Cached on `globalThis` because Next.js re-evaluates modules on every hot
 * reload in dev — without this you exhaust the Postgres connection limit after
 * a dozen saves.
 */

const globalForDb = globalThis as unknown as {
  __pgPool__?: Pool;
  __db__?: NodePgDatabase<typeof schema>;
};

function createPool(): Pool {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // Without a listener, an idle-client error is an unhandled 'error' event and
  // takes the process down.
  pool.on("error", (error) => {
    console.error("[db] idle client error", error);
  });

  return pool;
}

export function getPool(): Pool {
  if (!globalForDb.__pgPool__) {
    globalForDb.__pgPool__ = createPool();
  }
  return globalForDb.__pgPool__;
}

function createDb(): NodePgDatabase<typeof schema> {
  return drizzle(getPool(), {
    schema,
    logger: !isProduction && process.env.DB_LOG === "1",
  });
}

if (!globalForDb.__db__) {
  globalForDb.__db__ = createDb();
}

export const db: NodePgDatabase<typeof schema> = globalForDb.__db__;

export type Database = typeof db;

/** Liveness probe used by `/api/health`. */
export async function pingDatabase(): Promise<
  { ok: true; latencyMs: number } | { ok: false; error: string }
> {
  const startedAt = Date.now();
  try {
    await getPool().query("SELECT 1");
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}

/** For scripts (seed, migrate) that must let the process exit. */
export async function closeDatabase(): Promise<void> {
  if (globalForDb.__pgPool__) {
    await globalForDb.__pgPool__.end();
    globalForDb.__pgPool__ = undefined;
    globalForDb.__db__ = undefined;
  }
}
