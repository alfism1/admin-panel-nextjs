import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Flag, ScrollText, Users } from "lucide-react";

import { StatCard, StatCardSkeleton } from "@/components/shared/stat-card";

const meta = {
  title: "Shared/StatCard",
  component: StatCard,
} satisfies Meta<typeof StatCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "Users",
    value: "1,284",
    icon: Users,
    hint: "12 banned · 43 unverified",
  },
};

export const RisingTrend: Story = {
  args: {
    label: "Audit entries (24h)",
    value: "3,102",
    icon: ScrollText,
    trend: { value: 18, label: "vs. yesterday" },
  },
};

/**
 * A falling number can be good news. `trendPolarity` decouples the colour from
 * the sign, so dropping error counts render green.
 */
export const FallingIsGood: Story = {
  args: {
    label: "Failed sign-ins",
    value: "7",
    icon: Flag,
    trend: { value: -42, label: "vs. last week" },
    trendPolarity: "down-is-good",
  },
};

export const Loading: Story = {
  args: Default.args,
  render: () => <StatCardSkeleton />,
};

export const GridAtMobile: Story = {
  args: Default.args,
  globals: { viewport: { value: "mobile" } },
  render: () => (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Users" value="1,284" icon={Users} hint="12 banned" />
      <StatCard
        label="Feature flags"
        value="4/9"
        icon={Flag}
        hint="enabled / total"
      />
    </div>
  ),
};
