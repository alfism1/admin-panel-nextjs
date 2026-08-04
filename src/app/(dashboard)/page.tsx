import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Flag, ScrollText, ShieldCheck, Users } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard, StatCardSkeleton } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { auditLogService } from "@/modules/audit-log/audit-log.service";
import { featureFlagService } from "@/modules/feature-flags/feature-flag.service";
import { getAuthorization } from "@/modules/rbac/permissions.service";
import { rbacRepository } from "@/modules/rbac/rbac.repository";
import { usersService } from "@/modules/users/users.service";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const authorization = await getAuthorization();

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName(authorization?.user.name ?? "there")}`}
        description="Everything the panel knows about itself, at a glance."
      />

      <div className="space-y-6">
        <Suspense fallback={<StatGridSkeleton />}>
          <StatGrid />
        </Suspense>

        <div className="grid gap-4 lg:grid-cols-2">
          <Suspense fallback={null}>
            <RecentActivity />
          </Suspense>
          <YourAccess />
        </div>
      </div>
    </>
  );
}

async function StatGrid() {
  // One round of parallel reads rather than four sequential awaits.
  const [userStats, roles, flagStats, auditStats] = await Promise.all([
    usersService.getStats(),
    rbacRepository.listRoles(),
    featureFlagService.getStats(),
    auditLogService.getStats(),
  ]);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Users"
        value={userStats.total.toLocaleString()}
        icon={Users}
        hint={`${userStats.banned} banned · ${userStats.unverified} unverified`}
      />
      <StatCard
        label="Roles"
        value={roles.length}
        icon={ShieldCheck}
        hint={`${roles.filter((role) => role.isSystem).length} system, ${roles.filter((role) => !role.isSystem).length} custom`}
      />
      <StatCard
        label="Feature flags"
        value={`${flagStats.enabled}/${flagStats.total}`}
        icon={Flag}
        hint="enabled / total"
      />
      <StatCard
        label="Audit entries (24h)"
        value={auditStats.last24Hours.toLocaleString()}
        icon={ScrollText}
        hint={`${auditStats.total.toLocaleString()} retained in total`}
      />
    </div>
  );
}

function StatGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <StatCardSkeleton key={index} />
      ))}
    </div>
  );
}

async function RecentActivity() {
  const { rows } = await auditLogService.listForDashboard(6);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent activity</CardTitle>
        <CardDescription>
          The last few recorded mutations across the panel.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing recorded yet. Every mutation writes an audit entry.
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 text-sm">
                <Badge variant="outline" className="shrink-0 font-mono text-xs">
                  {entry.action}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate">
                    {entry.actorEmail ?? "system"}
                    {entry.resourceId ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {entry.resourceType}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <time dateTime={entry.createdAt.toISOString()}>
                      {entry.createdAt.toLocaleString()}
                    </time>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href="/audit-logs">View all audit logs</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

async function YourAccess() {
  const authorization = await getAuthorization();
  if (!authorization) return null;

  const roleRows = await rbacRepository.findRolesByKeys(authorization.roleKeys);
  const byResource = new Map<string, string[]>();

  for (const key of authorization.permissionKeys) {
    const [resource = "", action = ""] = key.split(":");
    byResource.set(resource, [...(byResource.get(resource) ?? []), action]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your access</CardTitle>
        <CardDescription>
          Resolved from your roles on every request — this is exactly what the
          server enforces.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {roleRows.length === 0 ? (
            <Badge variant="outline">No role assigned</Badge>
          ) : (
            roleRows.map((role) => <Badge key={role.id}>{role.name}</Badge>)
          )}
        </div>

        <dl className="space-y-2 text-sm">
          {[...byResource.entries()].map(([resource, actions]) => (
            <div
              key={resource}
              className="flex items-start justify-between gap-4"
            >
              <dt className="font-medium">{resource}</dt>
              <dd className="text-right text-xs text-muted-foreground">
                {actions.sort().join(", ")}
              </dd>
            </div>
          ))}
          {byResource.size === 0 ? (
            <p className="text-sm text-muted-foreground">
              You hold no permissions yet. An administrator needs to assign you
              a role.
            </p>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
