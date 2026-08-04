import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Topbar } from "@/components/layout/topbar";

const meta = {
  title: "Layout/Topbar",
  component: Topbar,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/users" } },
    docs: {
      description: {
        component:
          "A Server Component in the app — only the interactive pieces inside it ship JavaScript. Breadcrumbs are hidden below `sm`, where the row already carries the menu button, search and account menu.",
      },
    },
  },
} satisfies Meta<typeof Topbar>;

export default meta;
type Story = StoryObj<typeof meta>;

const user = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  image: null,
  roleLabels: ["Super Admin"],
  isImpersonating: false,
};

export const Default: Story = { args: { user } };

export const MultipleRoles: Story = {
  args: { user: { ...user, roleLabels: ["Admin", "Viewer"] } },
};

/** While impersonating, the user menu offers "Stop impersonating" instead of sign-out. */
export const Impersonating: Story = {
  args: { user: { ...user, name: "Alan Turing", isImpersonating: true } },
};

export const Mobile: Story = {
  args: { user },
  globals: { viewport: { value: "mobile" } },
};

export const Tablet: Story = {
  args: { user },
  globals: { viewport: { value: "tablet" } },
};
