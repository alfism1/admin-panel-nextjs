import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Inbox, SearchX, ShieldCheck } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

const meta = {
  title: "Shared/EmptyState",
  component: EmptyState,
  parameters: {
    docs: {
      description: {
        component:
          'Distinguishes "nothing exists yet" from "your filters matched nothing" — they need different copy and a different action, and conflating them makes users think the app is broken.',
      },
    },
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing has been created yet — offer the create action. */
export const NoDataYet: Story = {
  args: {
    icon: Inbox,
    title: "No users yet",
    description: "Invite your first teammate, or run `pnpm db:seed`.",
    action: <Button type="button">Invite a user</Button>,
  },
};

/** Data exists but the current filters exclude it — offer to clear them. */
export const NoSearchResults: Story = {
  args: {
    icon: SearchX,
    title: "No matches",
    description: "No rows match the current search and filters.",
    action: (
      <Button type="button" variant="outline">
        Clear filters
      </Button>
    ),
  },
};

export const WithoutAction: Story = {
  args: {
    icon: ShieldCheck,
    title: "No roles yet",
    description: "Run `pnpm db:seed` to create the three system roles.",
  },
};

export const Mobile: Story = {
  args: NoDataYet.args,
  globals: { viewport: { value: "mobile" } },
};
