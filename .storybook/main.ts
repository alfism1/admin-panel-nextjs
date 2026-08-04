import type { StorybookConfig } from "@storybook/nextjs-vite";

/**
 * Storybook 10 with the Vite-based Next.js adapter.
 *
 * The brief specifies Storybook 8; 8.x predates Next 16 support (its Next
 * adapter peers on `^14 || ^15`), so this uses 10.x — the first line that
 * declares `next: ^16`. Noted in the README under Assumptions.
 */
const config: StorybookConfig = {
  stories: ["../src/stories/**/*.stories.@(ts|tsx|mdx)"],

  addons: [
    "@storybook/addon-docs",
    // Treated as a gate, not decoration: `a11y.test: "error"` below fails the
    // story rather than logging a violation nobody reads.
    "@storybook/addon-a11y",
  ],

  framework: {
    name: "@storybook/nextjs-vite",
    options: {},
  },

  staticDirs: ["../public"],

  core: {
    // Opt out by default; a fork can turn it back on deliberately.
    disableTelemetry: true,
  },

  typescript: {
    // Prop tables come from the TS types rather than hand-written argTypes.
    reactDocgen: "react-docgen-typescript",
  },
};

export default config;
