import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { UserMenu } from "@/components/layout/user-menu";

const meta = {
  title: "Layout/UserMenu",
  component: UserMenu,
  parameters: {
    nextjs: { appDirectory: true },
  },
} satisfies Meta<typeof UserMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    name: "Ada Lovelace",
    email: "ada@example.com",
    image: null,
    roleLabels: ["Super Admin"],
    isImpersonating: false,
  },
};

export const Open: Story = {
  args: Default.args,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Account menu/ }));
  },
};

export const NoRole: Story = {
  args: { ...Default.args, roleLabels: [] },
};

export const Mobile: Story = {
  args: Default.args,
  globals: { viewport: { value: "mobile" } },
};
