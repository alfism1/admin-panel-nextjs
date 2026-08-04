import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";

const meta = {
  title: "Layout/Breadcrumbs",
  component: Breadcrumbs,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/users" } },
    docs: {
      description: {
        component:
          "Derived from the pathname. Segments matching a nav entry use its title; opaque ids are truncated, because a full UUID wraps badly at 375px.",
      },
    },
  },
} satisfies Meta<typeof Breadcrumbs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Root: Story = {
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: "/" } } },
};

export const OneLevel: Story = {};

export const NestedWithId: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/users/6f1c9a2e-3b7d-4c11-9e55-8f2a1b3c4d5e",
      },
    },
  },
};

/** The leading "Dashboard" crumb is hidden below `sm` to save the row. */
export const Mobile: Story = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/feature-flags" },
    },
  },
  globals: { viewport: { value: "mobile" } },
};
