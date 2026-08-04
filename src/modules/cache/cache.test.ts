import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryCacheStore } from "./cache-store";
import { __setCacheStoreForTests, cache } from "./cache.service";

describe("cache service", () => {
  beforeEach(() => {
    __setCacheStoreForTests(new MemoryCacheStore());
  });

  afterEach(() => {
    __setCacheStoreForTests(undefined);
    vi.useRealTimers();
  });

  it("round-trips a value", async () => {
    await cache.set("k", { hello: "world" });
    expect(await cache.get("k")).toEqual({ hello: "world" });
  });

  it("returns undefined for a miss", async () => {
    expect(await cache.get("nope")).toBeUndefined();
  });

  it("distinguishes a cached null from a miss", async () => {
    // Otherwise `wrap` re-runs its producer for every legitimately-null value —
    // "this flag key doesn't exist" being the expensive one.
    await cache.set("explicit-null", null);
    expect(await cache.get("explicit-null")).toBeNull();
    expect(await cache.get("never-set")).toBeUndefined();
  });

  it("serves a cached null without re-running the producer", async () => {
    const producer = vi.fn().mockResolvedValue(null);
    await cache.wrap("k", producer);
    await cache.wrap("k", producer);
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it("runs the producer once and serves the rest from cache", async () => {
    const producer = vi.fn().mockResolvedValue("value");

    expect(await cache.wrap("k", producer)).toBe("value");
    expect(await cache.wrap("k", producer)).toBe("value");
    expect(await cache.wrap("k", producer)).toBe("value");

    expect(producer).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed load", async () => {
    const producer = vi
      .fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue("recovered");

    await expect(cache.wrap("k", producer)).rejects.toThrow("db down");
    expect(await cache.wrap("k", producer)).toBe("recovered");
  });

  it("expires entries once the TTL elapses", async () => {
    vi.useFakeTimers();
    await cache.set("k", "value", { ttlSeconds: 30 });

    vi.advanceTimersByTime(29_000);
    expect(await cache.get("k")).toBe("value");

    vi.advanceTimersByTime(2_000);
    expect(await cache.get("k")).toBeUndefined();
  });

  it("drops every key carrying an invalidated tag", async () => {
    await cache.set("a", 1, { tags: ["users"] });
    await cache.set("b", 2, { tags: ["users", "roles"] });
    await cache.set("c", 3, { tags: ["roles"] });

    await cache.invalidateTags("users");

    expect(await cache.get("a")).toBeUndefined();
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("c")).toBe(3);
  });

  it("leaves untagged entries alone", async () => {
    await cache.set("untagged", "keep");
    await cache.invalidateTags("users");
    expect(await cache.get("untagged")).toBe("keep");
  });

  it("deletes explicitly by key", async () => {
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.del("a");
    expect(await cache.get("a")).toBeUndefined();
    expect(await cache.get("b")).toBe(2);
  });

  it("fails open when the store throws", async () => {
    // A Redis outage must degrade latency, not availability.
    __setCacheStoreForTests({
      get: () => Promise.reject(new Error("connection refused")),
      set: () => Promise.reject(new Error("connection refused")),
      del: () => Promise.reject(new Error("connection refused")),
      tag: () => Promise.reject(new Error("connection refused")),
      invalidateTags: () => Promise.reject(new Error("connection refused")),
      clear: () => Promise.reject(new Error("connection refused")),
    });

    await expect(cache.get("k")).resolves.toBeUndefined();
    await expect(cache.set("k", 1)).resolves.toBeUndefined();
    await expect(cache.del("k")).resolves.toBeUndefined();
    await expect(cache.invalidateTags("users")).resolves.toBe(0);

    // And `wrap` still returns real data off the producer.
    await expect(cache.wrap("k", async () => "from db")).resolves.toBe(
      "from db",
    );
  });
});
