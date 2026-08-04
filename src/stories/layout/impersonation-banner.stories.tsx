import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ImpersonationBanner } from "@/components/layout/impersonation-banner";

const meta = {
  title: "Layout/ImpersonationBanner",
  component: ImpersonationBanner,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true },
    docs: {
      description: {
        component:
          "Deliberately loud and always visible: the most dangerous thing about impersonation is forgetting you're doing it and taking a destructive action as someone else.",
      },
    },
  },
} satisfies Meta<typeof ImpersonationBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { userName: "Alan Turing" } };

/** Wraps to two lines rather than truncating the name. */
export const Mobile: Story = {
  args: { userName: "Katherine Johnson" },
  globals: { viewport: { value: "mobile" } },
};
