import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { AUTH_COOKIE_PREFIX } from "@/lib/auth-cookies";

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts`. Same semantics, new name.
 *
 * This is an **optimistic** redirect layer, not an authorisation boundary.
 * Proxy can be deployed to a CDN edge and must not touch the database, so all
 * it does is look for a session cookie. A forged or expired cookie gets past
 * it — every dashboard route re-checks the real session server-side via
 * `requireSession()`, and every mutation re-checks permissions. Removing this
 * file would cost a redirect, not security.
 */

const AUTH_ROUTES = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
];

const PUBLIC_ROUTES = ["/two-factor"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // The prefix must match `advanced.cookiePrefix` in `lib/auth.ts`, hence the
  // shared constant — a mismatch here is a silent sign-in redirect loop.
  const hasSessionCookie = Boolean(
    getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX }),
  );
  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  // Signed in but sitting on sign-in/sign-up → send to the dashboard.
  if (isAuthRoute && hasSessionCookie) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (isAuthRoute || isPublicRoute) {
    return NextResponse.next();
  }

  // Everything else is dashboard surface: require a cookie, and remember where
  // the user was headed so sign-in can send them back.
  if (!hasSessionCookie) {
    const signInUrl = new URL("/sign-in", request.url);
    const target = `${pathname}${search}`;
    if (target !== "/") {
      signInUrl.searchParams.set("redirect", target);
    }
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Everything except Next internals, static assets, and `/api/*`.
   *
   * `/api/auth/*` must be excluded or sign-in itself would be redirected to
   * sign-in. The other API routes authorise themselves — see
   * `withApiHandler()`.
   */
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
