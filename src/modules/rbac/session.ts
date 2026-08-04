import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";

/**
 * Session access for Server Components, Server Actions and Route Handlers.
 *
 * Two flavours, and the difference matters:
 *
 *  - `getSession()` may be served from the signed cookie cache. Fast, and fine
 *    for rendering "who am I" chrome.
 *  - `getFreshSession()` forces a read through to Redis/Postgres. Required
 *    before any privileged decision, because the cookie snapshot can be up to
 *    `cookieCache.maxAge` old — long enough for a user who was just banned or
 *    demoted to still be carrying a cookie that says otherwise.
 *
 * `requirePermission()` always uses the fresh path. Nothing else should need to
 * think about it.
 */

export type AuthSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;
export type AuthUser = AuthSession["user"];

/**
 * `react.cache` dedupes within a single render pass, so a layout, a page and
 * three components asking "who is signed in?" cost one lookup, not five.
 */
export const getSession = cache(async (): Promise<AuthSession | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  return session ?? null;
});

export const getFreshSession = cache(async (): Promise<AuthSession | null> => {
  const session = await auth.api.getSession({
    headers: await headers(),
    query: { disableCookieCache: true },
  });
  return session ?? null;
});

/**
 * Server Component guard: redirects to sign-in, preserving where they were
 * headed. Never returns null, so callers don't need a null branch.
 */
export async function requireSession(
  redirectPath?: string,
): Promise<AuthSession> {
  const session = await getSession();
  if (!session) {
    const target = redirectPath
      ? `/sign-in?redirect=${encodeURIComponent(redirectPath)}`
      : "/sign-in";
    redirect(target);
  }
  return session;
}

/**
 * Server Action / Route Handler guard: throws instead of redirecting, because
 * a redirect inside a POST is not a useful answer to "you are not signed in".
 */
export async function requireAuthenticated(): Promise<AuthSession> {
  const session = await getFreshSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

/** True while an admin is acting as this user via the impersonation feature. */
export function isImpersonating(session: AuthSession | null): boolean {
  if (!session) return false;
  const impersonatedBy = (session.session as { impersonatedBy?: string | null })
    .impersonatedBy;
  return Boolean(impersonatedBy);
}

/** Role keys for a user. `users.role` is Better-Auth's comma-separated string. */
export function roleKeysOf(
  user: Pick<AuthUser, "id"> & { role?: unknown },
): string[] {
  const raw = user.role;
  if (typeof raw !== "string" || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}
