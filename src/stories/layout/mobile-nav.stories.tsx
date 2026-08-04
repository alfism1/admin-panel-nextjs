import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { MobileNav } from "@/components/layout/mobile-nav";

const meta = {
  title: "Layout/MobileNav",
  component: MobileNav,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/users" } },
    docs: {
      description: {
        component:
          "Off-canvas drawer for < 768px. Radix Dialog underneath provides focus trapping, Escape-to-close, scroll lock and `aria-modal`.",
      },
    },
  },
} satisfies Meta<typeof MobileNav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {
  globals: { viewport: { value: "mobile" } },
};

export const Open: Story = {
  globals: { viewport: { value: "mobile" } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Open navigation menu" }),
    );
  },
};

export const OpenAsViewer: Story = {
  globals: { viewport: { value: "mobile" } },
  parameters: { permissions: ["user:read"] },
  play: Open.play,
};
