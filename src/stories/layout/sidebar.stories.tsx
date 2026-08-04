import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Sidebar } from "@/components/layout/sidebar";

const meta = {
  title: "Layout/Sidebar",
  component: Sidebar,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/users" } },
    docs: {
      description: {
        component:
          "Responsive contract: hidden below 768px (navigation moves to `MobileNav`), an always-collapsed icon rail at 768–1023px, and full width and user-collapsible at 1024px+.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="flex h-[32rem]">
        <Story />
        <div className="flex-1 p-6 text-sm text-muted-foreground">
          Page content sits here.
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 1280px — full width, labels visible. */
export const Desktop: Story = {
  globals: { viewport: { value: "desktop" } },
};

/** 768px — icon rail. Labels stay in the DOM as `sr-only` so links remain announceable. */
export const TabletRail: Story = {
  globals: { viewport: { value: "tablet" } },
};

/** 375px — not rendered at all. Use `MobileNav` instead. */
export const HiddenOnMobile: Story = {
  globals: { viewport: { value: "mobile" } },
};

/** A viewer sees only the sections their role permits. */
export const ReadOnlyUser: Story = {
  globals: { viewport: { value: "desktop" } },
  parameters: {
    permissions: ["user:read", "auditLog:read"],
  },
};

/** Nav is empty apart from ungated entries when nothing is granted. */
export const NoPermissions: Story = {
  globals: { viewport: { value: "desktop" } },
  parameters: { permissions: [] },
};
