import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin as adminPlugin, twoFactor } from "better-auth/plugins";

import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { AUTH_COOKIE_PREFIX } from "@/lib/auth-cookies";
import { appUrl, env, isProduction } from "@/lib/env";
import { getLogger } from "@/lib/logger";
import { resetPasswordEmail, sendMail, verificationEmail } from "@/lib/mail";
import { ac, betterAuthRoles } from "@/lib/permissions";
import { getRedis } from "@/lib/redis";

/**
 * Better-Auth server configuration — the single place authentication is
 * defined. Everything else (`proxy.ts`, `modules/rbac`, Server Actions) reads
 * sessions through `auth.api.getSession`.
 */

const baseURL = env.BETTER_AUTH_URL ?? appUrl;

/**
 * `Secure` cookies are refused by browsers over plain HTTP, so this must track
 * the *public origin*, not `NODE_ENV`.
 *
 * Deriving it from `NODE_ENV` breaks two real setups: a production build served
 * over http for testing (the browser silently drops the session cookie and
 * every request looks signed-out), and a development build on an https tunnel.
 * Behind a TLS-terminating proxy the public URL is still https, so this stays
 * correct there too.
 */
const useSecureCookies = baseURL.startsWith("https://");

const authMax = env.AUTH_RATE_LIMIT_MAX;
const authWindow = env.AUTH_RATE_LIMIT_WINDOW_SECONDS;

const THIRTY_DAYS_IN_SECONDS = 60 * 60 * 24 * 30;
const ONE_DAY_IN_SECONDS = 60 * 60 * 24;
const FIVE_MINUTES_IN_SECONDS = 60 * 5;

/**
 * Redis as Better-Auth secondary storage: session lookups hit Redis instead of
 * Postgres on every request. Sessions are *also* written to the database
 * (`storeSessionInDatabase`) so the admin UI can list and revoke them, and so a
 * Redis flush logs nobody out.
 */
function createSecondaryStorage() {
  const redis = getRedis();
  if (!redis) return undefined;

  return {
    get: async (key: string) => redis.get(key),
    set: async (key: string, value: string, ttl?: number) => {
      if (ttl) await redis.set(key, value, "EX", ttl);
      else await redis.set(key, value);
    },
    delete: async (key: string) => {
      await redis.del(key);
    },
    getAndDelete: async (key: string) => redis.getdel(key),
    increment: async (key: string, ttl: number) => {
      const value = await redis.incr(key);
      // TTL is set on creation only, so the window is fixed from first request.
      if (value === 1) await redis.expire(key, ttl);
      return value;
    },
  };
}

/** A provider is only registered when both halves of its credential pair exist. */
function socialProviders() {
  const providers: NonNullable<
    Parameters<typeof betterAuth>[0]["socialProviders"]
  > = {};

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    };
  }

  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    providers.github = {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    };
  }

  return providers;
}

/** Which OAuth buttons the sign-in page should render. Safe to send to a client. */
export const enabledSocialProviders = Object.keys(
  socialProviders(),
) as readonly ("google" | "github")[];

export const auth = betterAuth({
  appName: "Modern Admin",
  baseURL,
  secret: env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      twoFactor: schema.twoFactor,
    },
  }),

  secondaryStorage: createSecondaryStorage(),

  emailAndPassword: {
    enabled: true,
    /** No sign-in until the address is proven. */
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      await sendMail({ to: user.email, ...resetPasswordEmail(url) });
    },
    resetPasswordTokenExpiresIn: 60 * 60,
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail({ to: user.email, ...verificationEmail(url) });
    },
  },

  socialProviders: socialProviders(),

  account: {
    accountLinking: {
      enabled: true,
      // Only for providers that verify the address themselves; otherwise a
      // provider could assert someone else's e-mail and take over the account.
      trustedProviders: ["google", "github"],
    },
  },

  session: {
    expiresIn: THIRTY_DAYS_IN_SECONDS,
    /** Sliding refresh: touching the session within a day extends it. */
    updateAge: ONE_DAY_IN_SECONDS,
    /**
     * Sessions live in Redis *and* Postgres. The database copy backs the
     * "active sessions" admin UI and survives a cache flush.
     */
    storeSessionInDatabase: true,
    preserveSessionInDatabase: false,
    cookieCache: {
      /**
       * Signed session snapshot in the cookie — avoids a Redis round-trip on
       * every RSC render. Privileged reads deliberately bypass it: see
       * `getFreshSession()` in `modules/rbac/session.ts`.
       */
      enabled: true,
      maxAge: FIVE_MINUTES_IN_SECONDS,
    },
  },

  verification: {
    // Required alongside `secondaryStorage`, or Better-Auth drops the table.
    storeInDatabase: true,
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    storage: getRedis() ? "secondary-storage" : "memory",
    /**
     * Credential endpoints get a far tighter budget than the global one —
     * these are the paths worth brute-forcing. Configurable via
     * `AUTH_RATE_LIMIT_*`; see the note in `lib/env.ts`.
     */
    customRules: {
      "/sign-in/email": { window: authWindow, max: authMax },
      "/sign-up/email": { window: authWindow * 60, max: authMax },
      "/request-password-reset": { window: authWindow * 60, max: authMax },
      "/reset-password": { window: authWindow * 60, max: authMax },
      "/two-factor/verify-totp": { window: authWindow, max: authMax },
      "/two-factor/verify-backup-code": { window: authWindow, max: authMax },
      "/send-verification-email": { window: authWindow * 60, max: authMax },
    },
  },

  advanced: {
    // Behind a proxy, the client IP is the first hop in x-forwarded-for.
    ipAddress: {
      ipAddressHeaders: ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"],
    },
    useSecureCookies,
    cookiePrefix: AUTH_COOKIE_PREFIX,
  },

  logger: {
    disabled: false,
    level: isProduction ? "error" : "info",
    log: (level, message, ...args) => {
      const log = getLogger({ scope: "better-auth" });
      const payload = args.length > 0 ? { args } : {};
      if (level === "error") log.error(payload, message);
      else if (level === "warn") log.warn(payload, message);
      else if (level === "debug") log.debug(payload, message);
      else log.info(payload, message);
    },
  },

  plugins: [
    adminPlugin({
      ac,
      roles: betterAuthRoles,
      /** New sign-ups land read-only; an admin promotes them deliberately. */
      defaultRole: "viewer",
      adminRoles: ["super_admin", "admin"],
      /** An impersonated session is short-lived by design. */
      impersonationSessionDuration: 60 * 60,
    }),
    twoFactor({
      issuer: "Modern Admin",
      totpOptions: { digits: 6, period: 30 },
      // Lock the factor after repeated bad codes rather than allowing a
      // brute-force of the 6-digit space.
      skipVerificationOnEnable: false,
    }),
    /**
     * Must be last: it wraps every response so `Set-Cookie` survives the
     * Next.js Server Action boundary.
     */
    nextCookies(),
  ],
});

export type Auth = typeof auth;
export type Session = Auth["$Infer"]["Session"]["session"];
export type SessionUser = Auth["$Infer"]["Session"]["user"];
