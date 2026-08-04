import type { Metadata } from "next";

import { Forbidden } from "@/components/shared/forbidden";
import { parseTableParams } from "@/lib/table-params";
import { FlagsView } from "@/modules/feature-flags/components/flags-view";
import { featureFlagService } from "@/modules/feature-flags/feature-flag.service";
import { hasPermission } from "@/modules/rbac/permissions.service";
import { rbacRepository } from "@/modules/rbac/rbac.repository";
import { usersRepository } from "@/modules/users/users.repository";

export const metadata: Metadata = { title: "Feature flags" };

export default async function FeatureFlagsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await hasPermission("featureFlag", "read"))) {
    return <Forbidden />;
  }

  const params = parseTableParams(await searchParams);

  const [flags, roles, previewUsers] = await Promise.all([
    featureFlagService.list(params.search),
    rbacRepository.listRoles(),
    // A small sample is enough for the rollout preview, and keeps this page
    // from loading the whole user table.
    usersRepository.sampleForPreview(12),
  ]);

  return (
    <FlagsView
      flags={flags.map((flag) => ({
        id: flag.id,
        key: flag.key,
        name: flag.name,
        description: flag.description,
        enabled: flag.enabled,
        rules: flag.rules,
        updatedAt: flag.updatedAt.toISOString(),
      }))}
      params={params}
      roleOptions={roles.map((role) => ({ key: role.key, name: role.name }))}
      previewUsers={previewUsers}
    />
  );
}
