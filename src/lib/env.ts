import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Boot-time environment validation.
 *
 * Importing `env` anywhere fails fast (and loudly) when configuration is
 * missing or malformed, instead of surfacing as a confusing runtime error
 * three layers deep. Never read `process.env` directly outside this file.
 */
export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    DATABASE_URL: z
      .string()
      .min(1, "DATABASE_URL is required (see .env.example)"),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    /**
     * Optional: without it the app falls back to a single-process in-memory
     * cache. Acceptable for local dev, never for a multi-instance deployment.
     */
    REDIS_URL: z.string().min(1).optional(),

    BETTER_AUTH_SECRET: z
      .string()
      .min(
        16,
        "BETTER_AUTH_SECRET must be at least 16 characters — generate one with `openssl rand -base64 32`",
      ),
    BETTER_AUTH_URL: z.string().url().optional(),

    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),

    MAIL_TRANSPORT: z.enum(["console", "resend"]).default("console"),
    MAIL_FROM: z.string().min(1).default("Modern Admin <no-reply@example.com>"),
    RESEND_API_KEY: z.string().min(1).optional(),

    AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(90),

    /**
     * Sign-in / password-reset attempts allowed per IP per window. The defaults
     * are the secure ones; they are configurable because different deployments
     * sit behind different proxies (a shared NAT needs a higher ceiling), and
     * because an e2e suite signing in repeatedly from one address would
     * otherwise trip a limiter that is working exactly as intended.
     */
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
    AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60),

    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal"])
      .default("info"),

    SEED_ADMIN_EMAIL: z.string().email().default("admin@example.com"),
    SEED_ADMIN_PASSWORD: z.string().min(8).default("ChangeMe123!"),
    SEED_ADMIN_NAME: z.string().min(1).default("Super Admin"),
  },

  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  },

  /**
   * Next.js only inlines statically-analysable `process.env.X` references, so
   * every variable has to be spelled out here.
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX,
    REDIS_URL: process.env.REDIS_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    MAIL_TRANSPORT: process.env.MAIL_TRANSPORT,
    MAIL_FROM: process.env.MAIL_FROM,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    AUDIT_LOG_RETENTION_DAYS: process.env.AUDIT_LOG_RETENTION_DAYS,
    AUTH_RATE_LIMIT_MAX: process.env.AUTH_RATE_LIMIT_MAX,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    LOG_LEVEL: process.env.LOG_LEVEL,
    SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL,
    SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD,
    SEED_ADMIN_NAME: process.env.SEED_ADMIN_NAME,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },

  /** Treat `FOO=` in a .env file as "not set" so defaults apply. */
  emptyStringAsUndefined: true,

  /** Escape hatch for Docker builds and CI steps that only need a bundle. */
  skipValidation:
    process.env.SKIP_ENV_VALIDATION === "1" ||
    process.env.SKIP_ENV_VALIDATION === "true",
});

/** Absolute origin the app is served from. */
export const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
