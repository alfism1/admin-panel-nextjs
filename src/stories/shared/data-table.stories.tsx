import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  DataTable,
  TableSkeleton,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { TableToolbar } from "@/components/shared/table-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DEFAULT_PAGE_SIZE, type TableParams } from "@/lib/table-params";

interface Row {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "active" | "banned";
}

const rows: Row[] = [
  {
    id: "1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    role: "Super Admin",
    status: "active",
  },
  {
    id: "2",
    name: "Grace Hopper",
    email: "grace@example.com",
    role: "Admin",
    status: "active",
  },
  {
    id: "3",
    name: "Alan Turing",
    email: "alan@example.com",
    role: "Viewer",
    status: "banned",
  },
  {
    id: "4",
    name: "Katherine Johnson",
    email: "katherine@example.com",
    role: "Admin",
    status: "active",
  },
  {
    id: "5",
    name: "Margaret Hamilton",
    email: "margaret@example.com",
    role: "Viewer",
    status: "active",
  },
];

const columns: DataTableColumn<Row>[] = [
  {
    id: "name",
    header: "Name",
    sortKey: "name",
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{row.original.name}</p>
        <p className="truncate text-sm text-muted-foreground">
          {row.original.email}
        </p>
      </div>
    ),
  },
  {
    id: "role",
    header: "Role",
    cell: ({ row }) => <Badge variant="secondary">{row.original.role}</Badge>,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge
        variant={row.original.status === "banned" ? "destructive" : "outline"}
      >
        {row.original.status}
      </Badge>
    ),
  },
];

const params: TableParams = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sort: "name",
  order: "asc",
  search: "",
  filters: {},
};

const meta = {
  title: "Shared/DataTable",
  component: DataTable<Row>,
  parameters: {
    docs: {
      description: {
        component:
          "Server-driven table: sorting, filtering and paging are URL state a Server Component turns into a LIMIT/OFFSET query. Below `md` the `<table>` is replaced by a card list — a real layout swap, not `overflow-x: auto`.",
      },
    },
  },
} satisfies Meta<typeof DataTable<Row>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    columns,
    data: rows,
    totalRows: rows.length,
    params,
    getRowId: (row) => row.id,
  },
};

export const WithToolbar: Story = {
  args: {
    ...Default.args,
    toolbar: (
      <TableToolbar
        searchPlaceholder="Search by name or e-mail…"
        filters={[
          {
            name: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "banned", label: "Banned" },
            ],
          },
        ]}
      />
    ),
  },
};

/** Selecting rows reveals the bulk-action bar. */
export const WithBulkActions: Story = {
  args: {
    ...WithToolbar.args,
    bulkActions: (selectedIds) => (
      <Button type="button" variant="destructive" size="sm">
        Ban {selectedIds.length} selected
      </Button>
    ),
  },
};

export const Loading: Story = {
  args: { ...Default.args, isLoading: true },
};

export const Skeleton: Story = {
  args: Default.args,
  render: () => <TableSkeleton rows={5} />,
};

export const Empty: Story = {
  args: {
    ...Default.args,
    data: [],
    totalRows: 0,
    emptyTitle: "No users yet",
    emptyDescription: "Invite your first teammate, or run `pnpm db:seed`.",
    emptyAction: <Button type="button">Invite a user</Button>,
  },
};

/** Filters applied but nothing matched — distinct copy, and a way back. */
export const EmptyWithFilters: Story = {
  args: {
    ...Default.args,
    data: [],
    totalRows: 0,
    params: { ...params, search: "zzz" },
  },
};

/** At 375px rows become cards. Verify there is no horizontal page scroll. */
export const Mobile: Story = {
  args: {
    ...WithBulkActions.args,
    renderMobileCard: (row) => (
      <div className="space-y-2">
        <p className="font-medium">{row.name}</p>
        <p className="text-sm text-muted-foreground">{row.email}</p>
        <div className="flex gap-1">
          <Badge variant="secondary">{row.role}</Badge>
          <Badge variant={row.status === "banned" ? "destructive" : "outline"}>
            {row.status}
          </Badge>
        </div>
      </div>
    ),
  },
  globals: { viewport: { value: "mobile" } },
};

export const Tablet: Story = {
  args: WithToolbar.args,
  globals: { viewport: { value: "tablet" } },
};
