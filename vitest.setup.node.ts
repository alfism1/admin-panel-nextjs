import { vi } from "vitest";

/**
 * Environment for service/repository tests.
 *
 * Set before any module reads `@/lib/env`, which validates at import time and
 * would otherwise abort the run.
 */
// `NODE_ENV` is read-only in @types/node; `stubEnv` is Vitest's supported way
// to set it.
vi.stubEnv("NODE_ENV", "test");
process.env.DATABASE_URL ??=
  "postgres://admin:admin@localhost:5432/modern_admin_test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-that-is-long-enough-32b";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.LOG_LEVEL ??= "fatal";
// Unset on purpose: the cache falls back to MemoryCacheStore, so tests don't
// need a Redis server.
delete process.env.REDIS_URL;

/**
 * `next/cache` is a server-runtime module with no standalone implementation.
 * Services call `revalidateTag` after a write; stubbing it keeps them testable
 * without booting Next.
 */
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

/** `headers()` only exists inside a request scope. */
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
}));
