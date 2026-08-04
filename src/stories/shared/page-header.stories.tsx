import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";

const meta = {
  title: "Shared/PageHeader",
  component: PageHeader,
  parameters: {
    docs: {
      description: {
        component:
          "The heading block every dashboard page opens with. Renders the page's single `<h1>`, so pages must not declare their own.",
      },
    },
  },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Users",
    description:
      "Every account in the panel. Actions you can't perform are hidden, and re-checked on the server.",
  },
};

export const WithActions: Story = {
  args: {
    ...Default.args,
    actions: (
      <Button type="button">
        <Plus className="size-4" aria-hidden />
        New user
      </Button>
    ),
  },
};

export const TitleOnly: Story = {
  args: { title: "Settings" },
};

/** At 375px the action drops below the title and stretches full width. */
export const Mobile: Story = {
  args: WithActions.args,
  globals: { viewport: { value: "mobile" } },
};
