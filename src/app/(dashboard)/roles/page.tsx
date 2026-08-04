import type { Metadata } from "next";

import { Forbidden } from "@/components/shared/forbidden";
import { RolesView } from "@/modules/rbac/components/roles-view";
import {
  getAuthorization,
  hasPermission,
} from "@/modules/rbac/permissions.service";
import { rbacService } from "@/modules/rbac/rbac.service";

export const metadata: Metadata = { title: "Roles" };

/**
 * Roles index.
 *
 * The permission check is explicit rather than relying on the service to throw
 * into `error.tsx`: a 403 on a page the user navigated to deserves a real
 * screen, not a generic error boundary.
 */
export default async function RolesPage() {
  if (!(await hasPermission("role", "read"))) {
    return <Forbidden />;
  }

  const [roles, permissions, authorization] = await Promise.all([
    rbacService.listRoles(),
    rbacService.listPermissions(),
    getAuthorization(),
  ]);

  return (
    <RolesView
      roles={roles.map((role) => ({
        id: role.id,
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        requireTwoFactor: role.requireTwoFactor,
        permissionKeys: role.permissionKeys,
        memberCount: role.memberCount,
      }))}
      permissions={permissions.map((permission) => ({
        key: `${permission.resource}:${permission.action}`,
        resource: permission.resource,
        action: permission.action,
      }))}
      // Drives which checkboxes are tickable — the server enforces the same
      // rule in `assertNoPrivilegeEscalation`.
      grantableKeys={[...(authorization?.permissionKeys ?? [])]}
    />
  );
}
