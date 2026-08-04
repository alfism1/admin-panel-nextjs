"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteRoleAction } from "@/modules/rbac/rbac.actions";
import { usePermission } from "@/modules/rbac/permission-provider";

import type { PermissionOption } from "./permission-matrix";
import { RoleDialog, type RoleDialogRole } from "./role-dialog";

/**
 * Roles index.
 *
 * A card grid rather than a table: a role's identity is its permission summary,
 * which needs more than one line and doesn't tabulate well at 375px.
 */
export function RolesView({
  roles,
  permissions,
  grantableKeys,
}: {
  roles: (RoleDialogRole & { memberCount: number })[];
  permissions: PermissionOption[];
  grantableKeys: string[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RoleDialogRole | null>(null);

  const canCreate = usePermission("role", "create");
  const canUpdate = usePermission("role", "update");
  const canDelete = usePermission("role", "delete");

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(role: RoleDialogRole) {
    setEditing(role);
    setDialogOpen(true);
  }

  async function remove(role: RoleDialogRole) {
    const result = await deleteRoleAction({ id: role.id });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Role "${role.name}" deleted.`);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Roles"
        description="Roles are stored in the database and editable at runtime. The permission matrix below is generated from the access-control statement in code."
        actions={
          canCreate ? (
            <Button type="button" onClick={openCreate}>
              <Plus className="size-4" aria-hidden />
              New role
            </Button>
          ) : null
        }
      />

      {roles.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No roles yet"
          description="Run `pnpm db:seed` to create the three system roles, or add one now."
          action={
            canCreate ? (
              <Button type="button" onClick={openCreate}>
                Create a role
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => (
            <Card key={role.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <span className="truncate">{role.name}</span>
                      {role.isSystem ? (
                        <Badge variant="secondary" className="gap-1">
                          <Lock className="size-3" aria-hidden />
                          system
                        </Badge>
                      ) : null}
                      {role.requireTwoFactor ? (
                        <Badge variant="outline">2FA required</Badge>
                      ) : null}
                    </CardTitle>
                    <CardDescription className="font-mono text-xs">
                      {role.key}
                    </CardDescription>
                  </div>

                  {canUpdate || canDelete ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Actions for ${role.name}`}
                        >
                          <MoreHorizontal className="size-4" aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canUpdate ? (
                          <DropdownMenuItem onSelect={() => openEdit(role)}>
                            <Pencil className="size-4" aria-hidden />
                            Edit
                          </DropdownMenuItem>
                        ) : null}
                        {canDelete && !role.isSystem ? (
                          <DropdownMenuItem
                            variant="destructive"
                            // Radix closes the menu on select, which would
                            // unmount the dialog with it — defer instead.
                            onSelect={(event) => {
                              event.preventDefault();
                              void remove(role);
                            }}
                          >
                            <Trash2 className="size-4" aria-hidden />
                            Delete
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col gap-3">
                {role.description ? (
                  <p className="text-sm text-muted-foreground">
                    {role.description}
                  </p>
                ) : null}

                <PermissionSummary permissionKeys={role.permissionKeys} />

                <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                  <span className="text-xs text-muted-foreground">
                    {role.memberCount}{" "}
                    {role.memberCount === 1 ? "member" : "members"}
                  </span>

                  <div className="flex gap-1">
                    {canUpdate ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(role)}
                      >
                        Edit permissions
                      </Button>
                    ) : null}
                    {canDelete && !role.isSystem ? (
                      <ConfirmDialog
                        trigger={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${role.name}`}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        }
                        title={`Delete "${role.name}"?`}
                        description={
                          <>
                            <p>
                              This removes the role and every permission grant
                              attached to it. It cannot be undone.
                            </p>
                            {role.memberCount > 0 ? (
                              <p className="font-medium text-destructive">
                                {role.memberCount}{" "}
                                {role.memberCount === 1 ? "user" : "users"}{" "}
                                still hold this role. Reassign them first.
                              </p>
                            ) : null}
                          </>
                        }
                        confirmLabel="Delete role"
                        destructive
                        confirmPhrase={role.key}
                        onConfirm={() => remove(role)}
                      />
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <RoleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        role={editing}
        permissions={permissions}
        grantableKeys={grantableKeys}
      />
    </>
  );
}

/** Compact `resource: n` summary so a card doesn't list 27 keys. */
function PermissionSummary({ permissionKeys }: { permissionKeys: string[] }) {
  const byResource = new Map<string, number>();
  for (const key of permissionKeys) {
    const resource = key.split(":")[0] ?? key;
    byResource.set(resource, (byResource.get(resource) ?? 0) + 1);
  }

  if (byResource.size === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No permissions granted — members can sign in but see nothing.
      </p>
    );
  }

  return (
    <ul className="flex flex-wrap gap-1.5">
      {[...byResource.entries()].map(([resource, total]) => (
        <li key={resource}>
          <Badge variant="outline" className="font-normal">
            {resource}
            <span className="ml-1 text-muted-foreground tabular-nums">
              {total}
            </span>
          </Badge>
        </li>
      ))}
    </ul>
  );
}
