"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Flag, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { TableToolbar } from "@/components/shared/table-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import type { TableParams } from "@/lib/table-params";
import { usePermission } from "@/modules/rbac/permission-provider";
import {
  deleteFeatureFlagAction,
  toggleFeatureFlagAction,
} from "@/modules/feature-flags/feature-flag.actions";

import { FlagDialog, type FlagRow } from "./flag-dialog";

export function FlagsView({
  flags,
  params,
  roleOptions,
  previewUsers,
}: {
  flags: FlagRow[];
  params: TableParams;
  roleOptions: { key: string; name: string }[];
  previewUsers: { id: string; email: string; roleKeys: string[] }[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FlagRow | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const canCreate = usePermission("featureFlag", "create");
  const canUpdate = usePermission("featureFlag", "update");
  const canToggle = usePermission("featureFlag", "toggle");
  const canDelete = usePermission("featureFlag", "delete");

  async function toggle(flag: FlagRow, enabled: boolean) {
    setPendingId(flag.id);
    const result = await toggleFeatureFlagAction({ id: flag.id, enabled });
    setPendingId(null);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`"${flag.name}" turned ${enabled ? "on" : "off"}.`);
    router.refresh();
  }

  async function remove(flag: FlagRow) {
    const result = await deleteFeatureFlagAction({ id: flag.id });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Flag "${flag.key}" deleted.`);
    router.refresh();
  }

  const columns: DataTableColumn<FlagRow>[] = [
    {
      id: "flag",
      header: "Flag",
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.original.name}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {row.original.key}
          </p>
        </div>
      ),
    },
    {
      id: "targeting",
      header: "Targeting",
      cell: ({ row }) => <TargetingSummary rules={row.original.rules} />,
    },
    {
      id: "updatedAt",
      header: "Updated",
      cell: ({ row }) => (
        <time
          dateTime={row.original.updatedAt}
          className="text-sm whitespace-nowrap text-muted-foreground"
        >
          {new Date(row.original.updatedAt).toLocaleDateString()}
        </time>
      ),
    },
    {
      id: "enabled",
      header: "Enabled",
      cell: ({ row }) => (
        <Switch
          checked={row.original.enabled}
          disabled={!canToggle || pendingId === row.original.id}
          onCheckedChange={(checked) => void toggle(row.original, checked)}
          aria-label={`${row.original.enabled ? "Disable" : "Enable"} ${row.original.name}`}
        />
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) =>
        canUpdate || canDelete ? (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Actions for ${row.original.name}`}
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canUpdate ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditing(row.original);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="size-4" aria-hidden />
                    Edit rules
                  </DropdownMenuItem>
                ) : null}
                {canDelete ? (
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={(event) => {
                      event.preventDefault();
                      void remove(row.original);
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    Delete
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Feature flags"
        description="Toggling a flag takes effect within 30 seconds, with no redeploy. Every change is recorded in the audit log."
        actions={
          canCreate ? (
            <Button
              type="button"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden />
              New flag
            </Button>
          ) : null
        }
      />

      <DataTable
        columns={columns}
        data={flags}
        totalRows={flags.length}
        params={params}
        getRowId={(flag) => flag.id}
        emptyTitle="No feature flags"
        emptyDescription="Create one to gate a code path without a redeploy."
        emptyAction={
          canCreate ? (
            <Button
              type="button"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Flag className="size-4" aria-hidden />
              Create a flag
            </Button>
          ) : null
        }
        toolbar={<TableToolbar searchPlaceholder="Search flags…" />}
        renderMobileCard={(flag) => (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{flag.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {flag.key}
                </p>
              </div>
              <Switch
                checked={flag.enabled}
                disabled={!canToggle || pendingId === flag.id}
                onCheckedChange={(checked) => void toggle(flag, checked)}
                aria-label={`${flag.enabled ? "Disable" : "Enable"} ${flag.name}`}
              />
            </div>

            {flag.description ? (
              <p className="text-sm text-muted-foreground">
                {flag.description}
              </p>
            ) : null}

            <TargetingSummary rules={flag.rules} />

            {canUpdate ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  setEditing(flag);
                  setDialogOpen(true);
                }}
              >
                Edit rules
              </Button>
            ) : null}

            {canDelete ? (
              <ConfirmDialog
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full text-destructive"
                  >
                    Delete flag
                  </Button>
                }
                title={`Delete "${flag.key}"?`}
                description={
                  <p>
                    Any code still calling{" "}
                    <code className="font-mono">
                      isFeatureEnabled(&quot;{flag.key}&quot;)
                    </code>{" "}
                    will get <code className="font-mono">false</code>. Remove
                    the call sites first.
                  </p>
                }
                confirmLabel="Delete flag"
                destructive
                confirmPhrase={flag.key}
                onConfirm={() => remove(flag)}
              />
            ) : null}
          </div>
        )}
      />

      <FlagDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        flag={editing}
        roleOptions={roleOptions}
        previewUsers={previewUsers}
      />
    </>
  );
}

function TargetingSummary({ rules }: { rules: FlagRow["rules"] }) {
  const badges: string[] = [];

  if (typeof rules.rolloutPercentage === "number") {
    badges.push(`${rules.rolloutPercentage}% rollout`);
  }
  if (rules.includeRoles?.length) {
    badges.push(`roles: ${rules.includeRoles.join(", ")}`);
  }
  if (rules.includeUserIds?.length) {
    badges.push(`+${rules.includeUserIds.length} users`);
  }
  if (rules.excludeUserIds?.length) {
    badges.push(`−${rules.excludeUserIds.length} users`);
  }

  if (badges.length === 0) {
    return <span className="text-sm text-muted-foreground">everyone</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((badge) => (
        <Badge key={badge} variant="outline" className="font-normal">
          {badge}
        </Badge>
      ))}
    </div>
  );
}
