import type { Metadata } from "next";

import { Forbidden } from "@/components/shared/forbidden";
import { parseTableParams } from "@/lib/table-params";
import {
  getAuthorization,
  hasPermission,
} from "@/modules/rbac/permissions.service";
import { rbacService } from "@/modules/rbac/rbac.service";
import { UsersView } from "@/modules/users/components/users-view";
import { usersService } from "@/modules/users/users.service";

export const metadata: Metadata = { title: "Users" };

/**
 * Users index.
 *
 * Table state comes in as search params and goes straight to the service, so
 * the database does the paging — the client only ever receives one page.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await hasPermission("user", "read"))) {
    return <Forbidden />;
  }

  const resolved = await searchParams;
  const params = parseTableParams(resolved);

  const [authorization, { rows, total }, roles] = await Promise.all([
    getAuthorization(),
    usersService.list({
      page: params.page,
      pageSize: params.pageSize,
      sort: params.sort ?? "createdAt",
      order: params.order,
      search: params.search,
      role: params.filters.role,
      status: params.filters.status,
    }),
    // Role names are needed to label badges even for users who can't assign
    // them; `role:read` is part of every seeded role.
    (await hasPermission("role", "read"))
      ? rbacService.listAssignableRoles()
      : Promise.resolve([]),
  ]);

  return (
    <UsersView
      users={rows.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        roleKeys: user.roleKeys,
        banned: user.banned,
        banReason: user.banReason,
        twoFactorEnabled: user.twoFactorEnabled,
        // Dates cross the server/client boundary as strings; formatting happens
        // client-side so it respects the viewer's locale.
        createdAt: user.createdAt.toISOString(),
      }))}
      totalRows={total}
      params={params}
      roles={roles}
      currentUserId={authorization?.user.id ?? ""}
    />
  );
}
