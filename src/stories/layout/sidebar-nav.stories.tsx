import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SidebarNav } from "@/components/layout/sidebar-nav";

const meta = {
  title: "Layout/SidebarNav",
  component: SidebarNav,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/users" } },
    docs: {
      description: {
        component:
          "The navigation list shared by the desktop rail and the mobile drawer, and the component that does the permission gating. Entries the user can't reach are removed, not disabled.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-64 rounded-lg border bg-sidebar p-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SidebarNav>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Full width, all sections — a super admin. */
export const Expanded: Story = {};

/**
 * Icon-only rail. Labels stay in the DOM as `sr-only` text so the links remain
 * announceable, with a `title` for sighted users on hover.
 */
export const Collapsed: Story = {
  args: { collapsed: true },
  decorators: [
    (Story) => (
      <div className="w-16 rounded-lg border bg-sidebar p-2">
        <Story />
      </div>
    ),
  ],
};

/** A read-only role: the Access and Operations entries it can reach, only. */
export const ReadOnlyUser: Story = {
  parameters: { permissions: ["user:read", "auditLog:read"] },
};

/** Nothing granted — only the ungated Dashboard and Settings entries remain. */
export const NoPermissions: Story = {
  parameters: { permissions: [] },
};

/** `aria-current="page"` marks the active route for assistive tech. */
export const ActiveRouteIsAuditLogs: Story = {
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/audit-logs" } },
  },
};
