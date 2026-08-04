/**
 * Cookie naming shared between the Better-Auth server config and `proxy.ts`.
 *
 * This lives in its own module with **no imports** on purpose. `proxy.ts` runs
 * in the edge runtime and may be deployed to a CDN, so it must not pull in
 * `lib/auth.ts` — that would drag the Drizzle client, `pg` and Redis into a
 * bundle that can't use any of them.
 *
 * Keeping the prefix here rather than inlining it in both files is not
 * cosmetic: when they disagree, `getSessionCookie()` silently finds nothing and
 * every signed-in user is redirected back to sign-in, in a loop.
 */
export const AUTH_COOKIE_PREFIX = "modern-admin";
