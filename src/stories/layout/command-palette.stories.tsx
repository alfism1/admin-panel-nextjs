import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { CommandPalette } from "@/components/layout/command-palette";

const meta = {
  title: "Layout/CommandPalette",
  component: CommandPalette,
  parameters: {
    nextjs: { appDirectory: true },
    docs: {
      description: {
        component:
          "Global search (⌘K / Ctrl+K). Entries the user can't access are filtered out — the palette must not become a directory of pages that 403.",
      },
    },
  },
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Trigger: Story = {};

export const Open: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Search or jump to a page" }),
    );
  },
};

/** A viewer sees a shorter list. */
export const OpenAsViewer: Story = {
  parameters: { permissions: ["user:read", "auditLog:read"] },
  play: Open.play,
};

/** Below `sm` the trigger collapses to an icon button. */
export const Mobile: Story = {
  globals: { viewport: { value: "mobile" } },
};
