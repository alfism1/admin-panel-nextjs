import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { TableToolbar } from "@/components/shared/table-toolbar";
import { Button } from "@/components/ui/button";

const meta = {
  title: "Shared/TableToolbar",
  component: TableToolbar,
  parameters: {
    docs: {
      description: {
        component:
          "Search + filters for `DataTable`. The search box is debounced and writes to the URL, so typing costs one navigation rather than one per keystroke, and the resulting view is linkable.",
      },
    },
  },
} satisfies Meta<typeof TableToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SearchOnly: Story = {
  args: { searchPlaceholder: "Search flags…" },
};

export const WithFilters: Story = {
  args: {
    searchPlaceholder: "Search by name or e-mail…",
    filters: [
      {
        name: "role",
        label: "Role",
        options: [
          { value: "super_admin", label: "Super Admin" },
          { value: "admin", label: "Admin" },
          { value: "viewer", label: "Viewer" },
        ],
      },
      {
        name: "status",
        label: "Status",
        options: [
          { value: "active", label: "Active" },
          { value: "banned", label: "Banned" },
          { value: "unverified", label: "Unverified" },
        ],
      },
    ],
  },
};

export const WithAction: Story = {
  args: {
    ...WithFilters.args,
    actions: (
      <Button type="button" variant="outline" size="sm">
        Export CSV
      </Button>
    ),
  },
};

/** Filters wrap below the search field rather than overflowing. */
export const Mobile: Story = {
  args: WithFilters.args,
  globals: { viewport: { value: "mobile" } },
};
