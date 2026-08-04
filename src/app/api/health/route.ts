import { NextResponse } from "next/server";

import { pingDatabase } from "@/db/client";
import { REQUEST_ID_HEADER, newRequestId } from "@/lib/logger";
import { hasRedis, pingRedis } from "@/lib/redis";

/**
 * Liveness/readiness probe.
 *
 * Unauthenticated on purpose — a load balancer can't sign in. It exposes only
 * booleans and latencies, never versions, connection strings or error details
 * that would help someone fingerprint the deployment.
 *
 * `200` = every required dependency is reachable. `503` = at least one is not,
 * so an orchestrator should pull this instance out of rotation.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = newRequestId();
  const startedAt = Date.now();

  const [database, redis] = await Promise.all([
    pingDatabase(),
    hasRedis()
      ? pingRedis()
      : Promise.resolve({ ok: false as const, error: "not configured" }),
  ]);

  // Redis is optional in development: without it the app falls back to the
  // in-memory cache, which is degraded but functional.
  const redisRequired = hasRedis();
  const healthy = database.ok && (!redisRequired || redis.ok);

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      uptimeSeconds: Math.round(process.uptime()),
      checks: {
        database: database.ok
          ? { ok: true, latencyMs: database.latencyMs }
          : { ok: false },
        redis: redis.ok
          ? { ok: true, latencyMs: redis.latencyMs }
          : { ok: false, required: redisRequired },
      },
      tookMs: Date.now() - startedAt,
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        [REQUEST_ID_HEADER]: requestId,
        "Cache-Control": "no-store",
      },
    },
  );
}
