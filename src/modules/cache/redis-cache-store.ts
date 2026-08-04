import "server-only";

import type Redis from "ioredis";

import { TAG_KEY_PREFIX, type CacheStore } from "./cache-store";

/**
 * Redis-backed cache store.
 *
 * Tags are modelled as Redis sets (`tag:{name}` → member keys). Invalidation
 * reads the set, deletes every member plus the set itself, in one pipeline.
 * Tag sets get a TTL slightly longer than their entries so abandoned tags
 * cannot grow unbounded.
 */
export class RedisCacheStore implements CacheStore {
  constructor(
    private readonly client: Redis,
    private readonly namespace = "cache",
  ) {}

  #key(key: string): string {
    return `${this.namespace}:${key}`;
  }

  #tagKey(tag: string): string {
    return `${this.namespace}:${TAG_KEY_PREFIX}${tag}`;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(this.#key(key));
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds > 0) {
      await this.client.set(this.#key(key), value, "EX", ttlSeconds);
    } else {
      await this.client.set(this.#key(key), value);
    }
  }

  async del(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.client.del(...keys.map((key) => this.#key(key)));
  }

  async tag(key: string, tags: string[], ttlSeconds: number): Promise<void> {
    if (tags.length === 0) return;
    const pipeline = this.client.pipeline();
    // Outlive the entries they point at, so a tag never expires mid-flight.
    const tagTtl = ttlSeconds > 0 ? ttlSeconds * 2 : 60 * 60 * 24;
    for (const tag of tags) {
      pipeline.sadd(this.#tagKey(tag), this.#key(key));
      pipeline.expire(this.#tagKey(tag), tagTtl);
    }
    await pipeline.exec();
  }

  async invalidateTags(tags: string[]): Promise<number> {
    if (tags.length === 0) return 0;

    const tagKeys = tags.map((tag) => this.#tagKey(tag));
    const memberLists = await Promise.all(
      tagKeys.map((tagKey) => this.client.smembers(tagKey)),
    );

    const members = [...new Set(memberLists.flat())];
    if (members.length === 0) {
      await this.client.del(...tagKeys);
      return 0;
    }

    const pipeline = this.client.pipeline();
    pipeline.del(...members);
    pipeline.del(...tagKeys);
    await pipeline.exec();

    return members.length;
  }

  async clear(): Promise<void> {
    // SCAN rather than KEYS: never block the server on a large keyspace.
    let cursor = "0";
    do {
      const [next, keys] = await this.client.scan(
        cursor,
        "MATCH",
        `${this.namespace}:*`,
        "COUNT",
        500,
      );
      cursor = next;
      if (keys.length > 0) await this.client.del(...keys);
    } while (cursor !== "0");
  }
}
