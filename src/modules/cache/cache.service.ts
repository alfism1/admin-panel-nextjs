import "server-only";

import { getRedis } from "@/lib/redis";
import { getLogger } from "@/lib/logger";

import { MemoryCacheStore, type CacheStore } from "./cache-store";
import { RedisCacheStore } from "./redis-cache-store";

/**
 * Cross-request cache (layer 1 of 2 — see ./README.md).
 *
 * Every method is fail-open: a Redis outage degrades to a cache miss and the
 * caller hits the database, it never takes the request down with it.
 */

const globalForCache = globalThis as unknown as { __cacheStore__?: CacheStore };

function getStore(): CacheStore {
  if (!globalForCache.__cacheStore__) {
    const redis = getRedis();
    globalForCache.__cacheStore__ = redis
      ? new RedisCacheStore(redis)
      : new MemoryCacheStore();
  }
  return globalForCache.__cacheStore__;
}

export interface CacheOptions {
  /** Seconds until expiry. `0` disables expiry (tag invalidation only). */
  ttlSeconds?: number;
  /** Tags this entry belongs to, for `cache.invalidateTags()`. */
  tags?: string[];
}

const DEFAULT_TTL_SECONDS = 60;

/**
 * `undefined` means **miss**; `null` means a `null` was cached.
 *
 * Collapsing the two would make `wrap` re-run its producer on every call for
 * any value that is legitimately `null` — "this flag key doesn't exist" being
 * the common one, which turns a deleted flag into a database query per render.
 */
async function get<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await getStore().get(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch (error) {
    getLogger({ key }).warn(
      { err: error },
      "cache.get failed — treating as miss",
    );
    return undefined;
  }
}

async function set<T>(
  key: string,
  value: T,
  options: CacheOptions = {},
): Promise<void> {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  try {
    const store = getStore();
    await store.set(key, JSON.stringify(value), ttlSeconds);
    if (options.tags?.length) {
      await store.tag(key, options.tags, ttlSeconds);
    }
  } catch (error) {
    getLogger({ key }).warn(
      { err: error },
      "cache.set failed — skipping write",
    );
  }
}

async function del(...keys: string[]): Promise<void> {
  try {
    await getStore().del(keys);
  } catch (error) {
    getLogger({ keys }).warn({ err: error }, "cache.del failed");
  }
}

/**
 * Cache-aside read. On a miss, `producer` runs and its result is written back.
 * `producer` errors propagate — a failed load must not be cached.
 */
async function wrap<T>(
  key: string,
  producer: () => Promise<T>,
  options: CacheOptions = {},
): Promise<T> {
  const hit = await get<T>(key);
  // `undefined` is the only miss signal — see `get`. A cached `null` is a hit.
  if (hit !== undefined) return hit;

  const value = await producer();
  await set(key, value, options);
  return value;
}

async function invalidateTags(...tags: string[]): Promise<number> {
  try {
    const removed = await getStore().invalidateTags(tags);
    getLogger({ tags, removed }).debug("cache tags invalidated");
    return removed;
  } catch (error) {
    getLogger({ tags }).warn({ err: error }, "cache.invalidateTags failed");
    return 0;
  }
}

async function clear(): Promise<void> {
  await getStore().clear();
}

export const cache = { get, set, del, wrap, invalidateTags, clear };

/**
 * Test seam — swap in a `MemoryCacheStore` (or a fake) without touching Redis.
 */
export function __setCacheStoreForTests(store: CacheStore | undefined): void {
  globalForCache.__cacheStore__ = store;
}
