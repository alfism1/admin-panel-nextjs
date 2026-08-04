import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite.
 *
 * Runs against a real build with real Postgres and Redis — the point of these
 * tests is the wiring between layers (proxy → layout → service → database),
 * which is exactly what mocks would paper over.
 *
 * `pnpm dev:services && pnpm db:migrate && pnpm db:seed` must have run first;
 * CI does that explicitly before invoking Playwright.
 */

const PORT = Number(process.env.E2E_PORT ?? 3210);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",

  // Auth flows mutate shared rows (bans, roles), so a file's steps must run in
  // order. Files themselves are independent and parallelise.
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,

  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,

  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "setup",
      testMatch: /global\.setup\.ts/,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      // The 375px specs belong to the `mobile` project below.
      testIgnore: /.*\.mobile\.spec\.ts/,
    },
    {
      /**
       * 375px, to hold the mobile-responsive requirement to account.
       *
       * Chromium at a phone viewport rather than `devices["iPhone SE"]`, which
       * is WebKit: this keeps CI to a single browser download, and what these
       * tests assert (layout at a width) doesn't depend on the engine.
       */
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },
        isMobile: false,
        hasTouch: true,
      },
      dependencies: ["setup"],
      testMatch: /.*\.mobile\.spec\.ts/,
    },
  ],

  webServer: {
    // `next start` rather than `next dev`: dev-only overlays and lazy
    // compilation make timings unrepresentative and flaky.
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      // `next start` forces NODE_ENV=production. Point the app's public origin
      // at the test server so auth callbacks, origin checks and cookie scope
      // all agree with where Playwright is actually browsing.
      NEXT_PUBLIC_APP_URL: baseURL,
      BETTER_AUTH_URL: baseURL,
      /**
       * The credential limiter defaults to 5 attempts/minute per IP. Every
       * worker here shares 127.0.0.1, so the suite would throttle itself on a
       * control that is working exactly as designed. Raised only for the test
       * server — `auth.spec.ts` still asserts the 429 path explicitly.
       */
      AUTH_RATE_LIMIT_MAX: "1000",
    },
  },
});
