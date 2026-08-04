import "server-only";

import Redis from "ioredis";

import { env, isProduction } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Redis singleton.
 *
 * Next.js dev mode re-evaluates modules on every hot reload, which would leak a
 * new TCP connection each time — so the client is stashed on `globalThis`.
 *
 * `REDIS_URL` is optional: when unset, `getRedis()` returns `null` and callers
 * degrade to the in-memory store (see `src/modules/cache`). That keeps
 * `pnpm dev` working with zero services running, but is explicitly refused in
 * production, where a shared cache is a correctness requirement.
 */

const globalForRedis = globalThis as unknown as {
  __redis__?: Redis | null;
};

function createClient(): Redis | null {
  if (!env.REDIS_URL) {
    if (isProduction) {
      throw new Error(
        "REDIS_URL is required in production: the in-memory cache fallback is not safe across multiple instances.",
      );
    }
    logger.warn(
      "REDIS_URL is not set — falling back to the in-memory cache. Do not do this in production.",
    );
    return null;
  }

  const client = new Redis(env.REDIS_URL, {
    // Fail fast instead of buffering commands forever when Redis is down.
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });

  client.on("error", (error: Error) => {
    logger.error({ err: error }, "Redis connection error");
  });
  client.on("connect", () => {
    logger.debug("Redis connected");
  });

  return client;
}

export function getRedis(): Redis | null {
  if (globalForRedis.__redis__ === undefined) {
    globalForRedis.__redis__ = createClient();
  }
  return globalForRedis.__redis__;
}

/** True when a Redis client is configured (not whether it is currently up). */
export function hasRedis(): boolean {
  return getRedis() !== null;
}

/** Liveness probe used by `/api/health`. */
export async function pingRedis(): Promise<
  { ok: true; latencyMs: number } | { ok: false; error: string }
> {
  const client = getRedis();
  if (!client) {
    return { ok: false, error: "REDIS_URL is not configured" };
  }

  const startedAt = Date.now();
  try {
    await client.ping();
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}
