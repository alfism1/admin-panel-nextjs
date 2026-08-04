import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";

const meta = {
  title: "Shared/ConfirmDialog",
  component: ConfirmDialog,
  parameters: {
    docs: {
      description: {
        component:
          "Built on Radix AlertDialog: focus is trapped, Escape cancels, and Cancel is the default focus target so a stray Enter dismisses rather than confirms.",
      },
    },
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    trigger: <Button type="button">Revoke sessions</Button>,
    title: "Revoke every session?",
    description: <p>They will be signed out on all devices immediately.</p>,
    confirmLabel: "Revoke",
    onConfirm: () => new Promise((resolve) => setTimeout(resolve, 800)),
  },
};

export const Destructive: Story = {
  args: {
    ...Default.args,
    trigger: (
      <Button type="button" variant="destructive">
        Delete user
      </Button>
    ),
    title: "Delete ada@example.com?",
    description: (
      <p>
        This permanently removes the account, its sessions and its linked
        providers. Audit entries they created are kept.
      </p>
    ),
    confirmLabel: "Delete user",
    destructive: true,
  },
};

/**
 * Type-to-confirm, for the genuinely unrecoverable. Used sparingly — if
 * everything demands typing, people stop reading.
 */
export const TypeToConfirm: Story = {
  args: {
    ...Destructive.args,
    title: 'Delete role "support_agent"?',
    description: (
      <p>
        This removes the role and every permission grant attached to it. It
        cannot be undone.
      </p>
    ),
    confirmPhrase: "support_agent",
  },
};

export const Mobile: Story = {
  args: Destructive.args,
  globals: { viewport: { value: "mobile" } },
};
