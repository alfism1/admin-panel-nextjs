import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Two projects in one run.
 *
 * `node` covers services, repositories and pure logic — the parts worth the
 * most coverage. `jsdom` covers components. Splitting them keeps the service
 * tests out of a DOM they don't need (faster, and they can't accidentally
 * depend on one).
 */
export default defineConfig({
  plugins: [react()],

  test: {
    globals: true,

    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.browser.test.ts"],
          setupFiles: ["./vitest.setup.node.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.dom.ts"],
        },
      },
    ],

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],

      /**
       * Scoped to the decision-making code: services, guards, and pure logic.
       *
       * Deliberately excluded, because a number covering them would be
       * misleading rather than useful:
       *  - `*.repository.ts` — SQL against a live database. Exercised by the
       *    Playwright suite, which runs against real Postgres.
       *  - `*.schema.ts` — zod declarations. Their behaviour is asserted where
       *    services parse them.
       *  - `*.actions.ts` — `"use server"` wrappers with no logic of their own.
       *  - `auth.ts` / `auth-client.ts` — third-party configuration.
       */
      include: ["src/modules/**/*.ts", "src/lib/**/*.ts"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/components/**",
        "src/**/*.repository.ts",
        "src/**/*.schema.ts",
        "src/**/*.actions.ts",
        "src/modules/cache/redis-cache-store.ts",
        "src/modules/cache/next-cache.ts",
        "src/lib/auth.ts",
        "src/lib/auth-client.ts",
        "src/lib/redis.ts",
        "src/lib/mail.ts",
        "src/lib/logger.ts",
        "src/lib/query-client.ts",
        "src/lib/api.ts",
      ],

      /**
       * A regression ratchet, set just below what the suite currently reaches
       * — not an aspiration. The uncovered remainder is mostly read paths that
       * authorise and then delegate to a repository; testing those asserts
       * "the mock was called", which is the coverage-for-its-own-sake the brief
       * warns against. Raise these as real behaviour gets tested.
       */
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 60,
        lines: 65,
      },
    },
  },

  resolve: {
    /** Resolves the `@/*` alias from tsconfig — no plugin needed. */
    tsconfigPaths: true,

    alias: {
      /**
       * Every service starts with `import "server-only"`, whose default entry
       * throws by design. Next neutralises it through the `react-server`
       * export condition; Vitest has no equivalent, so point it at a local
       * no-op. See test/server-only-stub.ts.
       */
      "server-only": new URL("./test/server-only-stub.ts", import.meta.url)
        .pathname,
    },
  },
});
