import "server-only";

/**
 * The storage contract behind `cache`. Two implementations ship:
 * `RedisCacheStore` (shared, production) and `MemoryCacheStore` (single
 * process, dev/test fallback).
 */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  /** `ttlSeconds` of 0 or less means "no expiry". */
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(keys: string[]): Promise<void>;
  /** Registers `key` as a member of each tag so it can be invalidated later. */
  tag(key: string, tags: string[], ttlSeconds: number): Promise<void>;
  /** Deletes every key registered under any of `tags`, plus the tag sets. */
  invalidateTags(tags: string[]): Promise<number>;
  clear(): Promise<void>;
}

export const TAG_KEY_PREFIX = "tag:";

/**
 * In-memory store. Correct for a single process only — two Next.js instances
 * would each hold their own copy and drift. Guarded against in production by
 * `src/lib/redis.ts`.
 */
export class MemoryCacheStore implements CacheStore {
  #entries = new Map<string, { value: string; expiresAt: number }>();
  #tags = new Map<string, Set<string>>();

  #isLive(entry: { expiresAt: number }): boolean {
    return entry.expiresAt === 0 || entry.expiresAt > Date.now();
  }

  async get(key: string): Promise<string | null> {
    const entry = this.#entries.get(key);
    if (!entry) return null;
    if (!this.#isLive(entry)) {
      this.#entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.#entries.set(key, {
      value,
      expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0,
    });
  }

  async del(keys: string[]): Promise<void> {
    for (const key of keys) this.#entries.delete(key);
  }

  async tag(key: string, tags: string[]): Promise<void> {
    for (const name of tags) {
      const members = this.#tags.get(name) ?? new Set<string>();
      members.add(key);
      this.#tags.set(name, members);
    }
  }

  async invalidateTags(tags: string[]): Promise<number> {
    let removed = 0;
    for (const name of tags) {
      const members = this.#tags.get(name);
      if (!members) continue;
      for (const key of members) {
        if (this.#entries.delete(key)) removed += 1;
      }
      this.#tags.delete(name);
    }
    return removed;
  }

  async clear(): Promise<void> {
    this.#entries.clear();
    this.#tags.clear();
  }
}
