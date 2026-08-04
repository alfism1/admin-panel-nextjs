import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";

/**
 * Next.js data cache (layer 2 of 2 — see ./README.md).
 *
 * Thin, typed wrappers so RSC read paths never reach for `unstable_cache`
 * directly and every invalidation goes through the same door.
 *
 * Hard rule: the wrapped function must not read `cookies()`/`headers()`. Next
 * refuses it, and more importantly a per-user value must never land in a cache
 * shared across users. Pass anything request-scoped in as an argument, and
 * include it in `keyParts`.
 */

type CachedQueryOptions = {
  /** Extra key parts. Anything the closure reads but does not receive as an argument belongs here. */
  keyParts: string[];
  tags: string[];
  /** Seconds. Omit for "until a tag invalidates it". */
  revalidateSeconds?: number;
};

export function cachedQuery<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  { keyParts, tags, revalidateSeconds }: CachedQueryOptions,
): (...args: TArgs) => Promise<TResult> {
  return unstable_cache(fn, keyParts, {
    tags,
    ...(revalidateSeconds === undefined
      ? {}
      : { revalidate: revalidateSeconds }),
  });
}

/**
 * Marks tagged RSC data stale with stale-while-revalidate semantics.
 *
 * Callable only from Server Actions and Route Handlers — never from Proxy or a
 * Client Component.
 */
export function invalidateQueryTags(...tags: string[]): void {
  for (const tag of tags) {
    // `profile: "max"` is the non-deprecated Next 16 signature; the one-arg
    // form does a blocking expiry and is on its way out.
    revalidateTag(tag, "max");
  }
}
