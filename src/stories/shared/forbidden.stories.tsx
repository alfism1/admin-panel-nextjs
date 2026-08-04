import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Forbidden } from "@/components/shared/forbidden";

const meta = {
  title: "Shared/Forbidden",
  component: Forbidden,
  parameters: {
    docs: {
      description: {
        component:
          "Rendered when `requirePermission()` refuses a page. Deliberately says nothing about whether the resource exists — a 403 that leaks that helps an attacker enumerate.",
      },
    },
  },
} satisfies Meta<typeof Forbidden>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomCopy: Story = {
  args: {
    title: "Exporting audit logs needs a higher role",
    description:
      "Exports leave the system and stop being subject to its access controls, so they sit behind auditLog:export rather than auditLog:read.",
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile" } },
};
