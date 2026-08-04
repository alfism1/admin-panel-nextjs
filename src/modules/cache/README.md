# Caching

There are **two independent cache layers** in this app. They solve different
problems and are invalidated by different calls. Conflating them is the single
most common source of "why is this stale?" bugs, so the split is enforced by
having two separate modules with no shared entry point.

|                   | Redis (`cache`)                                                                                                                    | Next.js data cache (`cachedQuery`)                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Module            | `@/modules/cache` → `cache.*`                                                                                                      | `@/modules/cache` → `cachedQuery`                              |
| Scope             | Shared across every process, request, and deployment                                                                               | Per-deployment render cache                                    |
| Stores            | Arbitrary JSON values                                                                                                              | The return value of an RSC data function                       |
| Read from         | Anywhere on the server                                                                                                             | Server Components / Server Actions                             |
| Written by        | You, explicitly (`cache.set` / `cache.wrap`)                                                                                       | Next, on first render                                          |
| Invalidated by    | `cache.invalidateTags(...)`                                                                                                        | `invalidateQueryTags(...)`                                     |
| Survives a deploy | Yes                                                                                                                                | No                                                             |
| Use it for        | Cross-request state: feature-flag evaluation, resolved permission sets, rate-limit counters, Better-Auth secondary session storage | Expensive RSC reads that render a page: users list, roles list |

## Rule of thumb

- **Redis** = _shared state_ other requests and other instances need to agree on.
- **Next data cache** = _render output_ for one deployment, keyed by its inputs.

A write usually needs to invalidate **both**. Do it in the service layer, next
to the mutation, so no call site can forget:

```ts
await featureFlagRepository.update(id, values);
await cache.invalidateTags(cacheTags.featureFlags, cacheTags.featureFlag(key));
invalidateQueryTags(cacheTags.featureFlags);
```

## Redis layer

```ts
import { cache, cacheKeys, cacheTags, cacheTtl } from "@/modules/cache";

const flag = await cache.wrap(
  cacheKeys.featureFlag(key),
  () => featureFlagRepository.findByKey(key),
  { ttlSeconds: cacheTtl.featureFlag, tags: [cacheTags.featureFlags] },
);
```

Every method **fails open**: if Redis is unreachable, a read is a miss and a
write is a no-op. The request still completes off the database. This is
deliberate — an unavailable cache should degrade latency, not availability.

`cache.get` returns `undefined` for a miss and `null` for a cached `null`. The
distinction matters: without it `cache.wrap` re-runs its producer for every
legitimately-null value, so a lookup of a deleted flag key would hit the
database on every render.

Tags are Redis sets (`cache:tag:{name}`) holding the keys tagged with them.
`invalidateTags` reads the set, deletes its members and the set, in one
pipeline.

Without `REDIS_URL` the layer transparently uses `MemoryCacheStore`, which is
correct for a single process only. `src/lib/redis.ts` throws on boot if
`NODE_ENV=production` and `REDIS_URL` is unset, so this fallback can never
reach production by accident.

## Next.js data cache layer

```ts
import { cachedQuery, cacheTags } from "@/modules/cache";

export const listUsersCached = cachedQuery(
  (params: ListUsersParams) => usersRepository.list(params),
  { keyParts: ["users:list"], tags: [cacheTags.users], revalidateSeconds: 60 },
);
```

Constraints worth remembering:

- The wrapped function **must not** read `cookies()` or `headers()`. Next
  rejects it, and a per-user value must never enter a cache shared by users.
  Pass request-scoped data in as an argument instead.
- Anything the closure captures but does not receive as an argument must be
  listed in `keyParts`, or two different inputs will collide on one entry.
- `invalidateQueryTags` is callable from Server Actions and Route Handlers
  only — never from `proxy.ts` or a Client Component.

## Key naming

All keys and tags live in [`cache-keys.ts`](./cache-keys.ts). Do not build a
key inline: keys constructed at the call site drift from the invalidation meant
to clear them, and the drift is silent.

## Forward path

`cachedQuery` wraps `unstable_cache`, which Next 16 supersedes with the
`use cache` directive plus `cacheTag`/`updateTag` under Cache Components. That
opt-in changes rendering semantics app-wide, so this boilerplate stays on the
stable API. When you adopt Cache Components, `next-cache.ts` is the only file
that needs to change.
