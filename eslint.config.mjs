import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";
import storybook from "eslint-plugin-storybook";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "storybook-static/**",
    "playwright-report/**",
    "test-results/**",
    "drizzle/**",
    "next-env.d.ts",
  ]),

  ...nextVitals,
  ...nextTs,
  ...storybook.configs["flat/recommended"],

  {
    // `eslint-config-next` already registers the jsx-a11y plugin, so re-adding
    // its flat config would throw "cannot redefine plugin". Pull in the strict
    // ruleset only and let the existing plugin registration serve it.
    rules: { ...jsxA11y.flatConfigs.strict.rules },
  },

  {
    rules: {
      // Unused vars are errors, but `_`-prefixed ones are an explicit opt-out.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
    },
  },

  {
    // shadcn/ui primitives are CLI-generated — lint them, but don't fail on
    // stylistic rules we don't control.
    files: ["src/components/ui/**/*.tsx"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
      eqeqeq: "off",
      "jsx-a11y/heading-has-content": "off",
      "jsx-a11y/anchor-has-content": "off",
      "jsx-a11y/no-noninteractive-element-to-interactive-role": "off",
      "jsx-a11y/no-noninteractive-element-interactions": "off",
      "jsx-a11y/click-events-have-key-events": "off",
    },
  },

  {
    files: [
      "src/db/seed.ts",
      "src/db/migrate.ts",
      "scripts/**/*.ts",
      "**/*.config.{ts,mts,js,mjs}",
      "e2e/**/*.ts",
    ],
    rules: {
      "no-console": "off",
    },
  },

  prettier,
]);

export default eslintConfig;
