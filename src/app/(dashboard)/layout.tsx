import { ImpersonationBanner } from "@/components/layout/impersonation-banner";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { rbacRepository } from "@/modules/rbac/rbac.repository";
import { getCurrentPermissionKeys } from "@/modules/rbac/permissions.service";
import { PermissionProvider } from "@/modules/rbac/permission-provider";
import {
  isImpersonating,
  requireSession,
  roleKeysOf,
} from "@/modules/rbac/session";

/**
 * The dashboard shell, and the real authentication boundary for every page
 * under it.
 *
 * `proxy.ts` already bounced requests without a session cookie, but that check
 * is optimistic — a forged cookie gets past it. This layout re-reads the actual
 * session server-side, so no page below can render for an unauthenticated user
 * even if Proxy is bypassed entirely.
 *
 * It also resolves the permission set once and hands it to `PermissionProvider`,
 * so client components can hide what the user can't do without a round-trip.
 */
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession();

  const [permissionKeys, roleRows] = await Promise.all([
    getCurrentPermissionKeys(),
    rbacRepository.findRolesByKeys(roleKeysOf(session.user)),
  ]);

  const impersonating = isImpersonating(session);

  return (
    <PermissionProvider permissionKeys={permissionKeys}>
      <div className="flex min-h-svh flex-col">
        {impersonating ? (
          <ImpersonationBanner userName={session.user.name} />
        ) : null}

        <div className="flex flex-1">
          <Sidebar />

          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar
              user={{
                name: session.user.name,
                email: session.user.email,
                image: session.user.image,
                roleLabels: roleRows.map((role) => role.name),
                isImpersonating: impersonating,
              }}
            />

            {/* `min-w-0` on every ancestor is what stops a wide table from
                forcing the whole page to scroll horizontally at 375px. */}
            <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
          </div>
        </div>
      </div>
    </PermissionProvider>
  );
}
