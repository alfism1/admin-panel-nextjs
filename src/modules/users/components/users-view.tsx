"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  KeyRound,
  MoreHorizontal,
  Pencil,
  Plus,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { TableToolbar } from "@/components/shared/table-toolbar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TableParams } from "@/lib/table-params";
import { usePermission } from "@/modules/rbac/permission-provider";
import {
  bulkBanUsersAction,
  deleteUserAction,
  impersonateUserAction,
  revokeUserSessionsAction,
  unbanUserAction,
} from "@/modules/users/users.actions";

import {
  AssignRolesDialog,
  BanUserDialog,
  CreateUserDialog,
  EditUserDialog,
  type RoleOption,
} from "./user-dialogs";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  roleKeys: string[];
  banned: boolean;
  banReason: string | null;
  twoFactorEnabled: boolean;
  createdAt: string;
}

/**
 * Users index — the reference implementation other module UIs copy.
 *
 * The pattern: a Server Component fetches a page of rows from the service, this
 * client component renders `DataTable` and owns dialog state, and every
 * mutation goes through a Server Action whose result is surfaced as a toast.
 */
export function UsersView({
  users,
  totalRows,
  params,
  roles,
  currentUserId,
}: {
  users: UserRow[];
  totalRows: number;
  params: TableParams;
  roles: RoleOption[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [assigning, setAssigning] = useState<UserRow | null>(null);
  const [banning, setBanning] = useState<UserRow | null>(null);

  const canCreate = usePermission("user", "create");
  const canUpdate = usePermission("user", "update");
  const canDelete = usePermission("user", "delete");
  const canBan = usePermission("user", "ban");
  const canAssignRoles = usePermission("role", "assign");
  const canImpersonate = usePermission("user", "impersonate");
  const canRevokeSessions = usePermission("session", "revoke");

  const hasRowActions =
    canUpdate || canDelete || canBan || canAssignRoles || canImpersonate;

  async function run(
    promise: Promise<{ ok: boolean; message?: string }>,
    successMessage: string,
  ) {
    const result = await promise;
    if (!result.ok) {
      toast.error(result.message ?? "That didn't work.");
      return;
    }
    toast.success(successMessage);
    router.refresh();
  }

  const columns: DataTableColumn<UserRow>[] = [
    {
      id: "user",
      header: "User",
      sortKey: "name",
      cell: ({ row }) => <UserCell user={row.original} />,
    },
    {
      id: "roles",
      header: "Roles",
      cell: ({ row }) =>
        row.original.roleKeys.length === 0 ? (
          <span className="text-sm text-muted-foreground">none</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.original.roleKeys.map((key) => (
              <Badge key={key} variant="secondary" className="font-normal">
                {roles.find((role) => role.key === key)?.name ?? key}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadges user={row.original} />,
    },
    {
      id: "createdAt",
      header: "Joined",
      sortKey: "createdAt",
      cell: ({ row }) => (
        <time
          dateTime={row.original.createdAt}
          className="text-sm whitespace-nowrap text-muted-foreground"
        >
          {new Date(row.original.createdAt).toLocaleDateString()}
        </time>
      ),
    },
  ];

  if (hasRowActions) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => <RowActions user={row.original} />,
    });
  }

  function RowActions({ user }: { user: UserRow }) {
    const isSelf = user.id === currentUserId;

    return (
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${user.name}`}
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-52">
            {canUpdate ? (
              <DropdownMenuItem onSelect={() => setEditing(user)}>
                <Pencil className="size-4" aria-hidden />
                Edit details
              </DropdownMenuItem>
            ) : null}

            {canAssignRoles ? (
              <DropdownMenuItem onSelect={() => setAssigning(user)}>
                <ShieldCheck className="size-4" aria-hidden />
                Manage roles
              </DropdownMenuItem>
            ) : null}

            {canRevokeSessions ? (
              <DropdownMenuItem
                onSelect={() =>
                  void run(
                    revokeUserSessionsAction({ id: user.id }),
                    "Sessions revoked.",
                  )
                }
              >
                <KeyRound className="size-4" aria-hidden />
                Revoke sessions
              </DropdownMenuItem>
            ) : null}

            {canImpersonate && !isSelf ? (
              <DropdownMenuItem
                onSelect={() =>
                  void run(
                    impersonateUserAction({ id: user.id }),
                    `Now impersonating ${user.name}.`,
                  )
                }
              >
                <UserCheck className="size-4" aria-hidden />
                Impersonate
              </DropdownMenuItem>
            ) : null}

            {(canBan || canDelete) && !isSelf ? (
              <DropdownMenuSeparator />
            ) : null}

            {canBan && !isSelf ? (
              user.banned ? (
                <DropdownMenuItem
                  onSelect={() =>
                    void run(
                      unbanUserAction({ id: user.id }),
                      `${user.name} unbanned.`,
                    )
                  }
                >
                  <ShieldOff className="size-4" aria-hidden />
                  Lift ban
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => setBanning(user)}>
                  <UserX className="size-4" aria-hidden />
                  Ban user
                </DropdownMenuItem>
              )
            ) : null}

            {canDelete && !isSelf ? (
              <DropdownMenuItem
                variant="destructive"
                onSelect={(event) => {
                  // Deletion is irreversible — force the confirm dialog rather
                  // than firing straight from a menu item.
                  event.preventDefault();
                }}
                asChild
              >
                <ConfirmDialog
                  trigger={
                    <button
                      type="button"
                      className="flex w-full items-center gap-2"
                    >
                      <Trash2 className="size-4" aria-hidden />
                      Delete user
                    </button>
                  }
                  title={`Delete ${user.name}?`}
                  description={
                    <p>
                      This permanently removes the account, its sessions and its
                      linked providers. Audit entries they created are kept.
                    </p>
                  }
                  confirmLabel="Delete user"
                  destructive
                  confirmPhrase={user.email}
                  onConfirm={() =>
                    run(
                      deleteUserAction({ id: user.id }),
                      `${user.name} deleted.`,
                    )
                  }
                />
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="Every account in the panel. Actions you can't perform are hidden, and re-checked on the server."
        actions={
          canCreate ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden />
              New user
            </Button>
          ) : null
        }
      />

      <DataTable
        columns={columns}
        data={users}
        totalRows={totalRows}
        params={params}
        getRowId={(user) => user.id}
        emptyTitle="No users yet"
        emptyDescription="Invite your first teammate, or run `pnpm db:seed`."
        toolbar={
          <TableToolbar
            searchPlaceholder="Search by name or e-mail…"
            filters={[
              {
                name: "role",
                label: "Role",
                options: roles.map((role) => ({
                  value: role.key,
                  label: role.name,
                })),
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
            ]}
          />
        }
        bulkActions={
          canBan
            ? (selectedIds, clear) => (
                <ConfirmDialog
                  trigger={
                    <Button type="button" variant="destructive" size="sm">
                      <UserX className="size-4" aria-hidden />
                      Ban selected
                    </Button>
                  }
                  title={`Ban ${selectedIds.length} ${selectedIds.length === 1 ? "user" : "users"}?`}
                  description={
                    <p>
                      Each ban is recorded separately in the audit log. Users
                      you aren&apos;t allowed to ban — including yourself — are
                      skipped.
                    </p>
                  }
                  confirmLabel="Ban them"
                  destructive
                  onConfirm={async () => {
                    const result = await bulkBanUsersAction(
                      { ids: selectedIds },
                      "Bulk ban from the users table",
                    );
                    if (!result.ok) {
                      toast.error(result.message);
                      return;
                    }
                    toast.success(
                      `Banned ${result.data.banned} of ${selectedIds.length}.`,
                    );
                    clear();
                    router.refresh();
                  }}
                />
              )
            : undefined
        }
        renderMobileCard={(user) => (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <UserCell user={user} />
              {hasRowActions ? <RowActions user={user} /> : null}
            </div>
            <StatusBadges user={user} />
            {user.roleKeys.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {user.roleKeys.map((key) => (
                  <Badge key={key} variant="secondary" className="font-normal">
                    {roles.find((role) => role.key === key)?.name ?? key}
                  </Badge>
                ))}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Joined{" "}
              <time dateTime={user.createdAt}>
                {new Date(user.createdAt).toLocaleDateString()}
              </time>
            </p>
          </div>
        )}
      />

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        roles={roles}
      />
      <EditUserDialog
        user={editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
      <AssignRolesDialog
        user={assigning}
        open={assigning !== null}
        onOpenChange={(open) => !open && setAssigning(null)}
        roles={roles}
      />
      <BanUserDialog
        user={banning}
        open={banning !== null}
        onOpenChange={(open) => !open && setBanning(null)}
      />
    </>
  );
}

function UserCell({ user }: { user: UserRow }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="size-8 shrink-0">
        {user.image ? <AvatarImage src={user.image} alt="" /> : null}
        <AvatarFallback className="text-xs">
          {user.name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate font-medium">{user.name}</p>
        <p className="truncate text-sm text-muted-foreground">{user.email}</p>
      </div>
    </div>
  );
}

function StatusBadges({ user }: { user: UserRow }) {
  return (
    <div className="flex flex-wrap gap-1">
      {user.banned ? (
        <Badge variant="destructive" title={user.banReason ?? undefined}>
          banned
        </Badge>
      ) : (
        <Badge variant="outline">active</Badge>
      )}
      {user.emailVerified ? null : <Badge variant="outline">unverified</Badge>}
      {user.twoFactorEnabled ? <Badge variant="outline">2FA</Badge> : null}
    </div>
  );
}
