import type { Metadata } from "next";

import { SettingsView } from "@/modules/auth/components/settings-view";
import { rbacRepository } from "@/modules/rbac/rbac.repository";
import { requireSession, roleKeysOf } from "@/modules/rbac/session";
import { usersRepository } from "@/modules/users/users.repository";

export const metadata: Metadata = { title: "Settings" };

/**
 * Account settings.
 *
 * The one dashboard page with no permission gate: it only ever acts on the
 * signed-in user, so a viewer with zero permissions can still change their own
 * password and enrol in 2FA.
 */
export default async function SettingsPage() {
  const session = await requireSession("/settings");
  const roleKeys = roleKeysOf(session.user);

  const [roles, sessions] = await Promise.all([
    rbacRepository.findRolesByKeys(roleKeys),
    usersRepository.listActiveSessions(session.user.id),
  ]);

  return (
    <SettingsView
      user={{
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        twoFactorEnabled: Boolean(
          (session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled,
        ),
      }}
      roleLabels={roles.map((role) => role.name)}
      twoFactorRequired={roles.some((role) => role.requireTwoFactor)}
      sessions={sessions.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        impersonatedBy: row.impersonatedBy,
      }))}
    />
  );
}
