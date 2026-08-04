import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ThemeToggle } from "@/components/layout/theme-toggle";

const meta = {
  title: "Layout/ThemeToggle",
  component: ThemeToggle,
  parameters: {
    docs: {
      description: {
        component:
          "light / dark / system via next-themes. The icon renders a stable placeholder until hydration, because the server can't know which theme will resolve.",
      },
    },
  },
} satisfies Meta<typeof ThemeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Change theme" }));
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile" } },
};
