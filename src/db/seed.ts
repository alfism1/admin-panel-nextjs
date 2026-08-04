import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { env } from "@/lib/env";
import {
  ALL_PERMISSION_KEYS,
  SYSTEM_ROLES,
  grantsToPermissionKeys,
  parsePermissionKey,
} from "@/lib/permissions";

import { closeDatabase, db } from "./client";
import type { FeatureFlagRules } from "./schema/feature-flags";
import {
  auditLogs,
  account as accountTable,
  featureFlags,
  permissions,
  rolePermissions,
  roles,
  user as userTable,
} from "./schema";

/**
 * Idempotent seed. Safe to re-run: everything upserts by natural key, so this
 * doubles as the "reconcile the permission catalogue after adding a resource"
 * command.
 *
 * Creates: the permission catalogue, the three system roles, one super-admin
 * user with a usable password, sample feature flags, and a few audit entries so
 * the log UI isn't empty on first run.
 */

async function syncPermissionCatalog(): Promise<Map<string, string>> {
  const existing = await db.select().from(permissions);
  const byKey = new Map(
    existing.map((row) => [`${row.resource}:${row.action}`, row.id]),
  );

  const missing = ALL_PERMISSION_KEYS.filter((key) => !byKey.has(key));
  if (missing.length > 0) {
    const rows = missing.flatMap((key) => {
      const parsed = parsePermissionKey(key);
      if (!parsed) return [];
      return [
        {
          id: randomUUID(),
          resource: parsed.resource,
          action: parsed.action,
          description: `Allows ${parsed.action} on ${parsed.resource}`,
        },
      ];
    });
    const inserted = await db.insert(permissions).values(rows).returning();
    for (const row of inserted) {
      byKey.set(`${row.resource}:${row.action}`, row.id);
    }
    console.log(`[seed] + ${inserted.length} permissions`);
  }

  // Actions removed from the statement are dropped so the matrix can't offer a
  // permission nothing checks. Cascades clean up role_permissions.
  const stale = existing.filter(
    (row) =>
      !(ALL_PERMISSION_KEYS as string[]).includes(
        `${row.resource}:${row.action}`,
      ),
  );
  if (stale.length > 0) {
    await db.delete(permissions).where(
      inArray(
        permissions.id,
        stale.map((row) => row.id),
      ),
    );
    console.log(`[seed] - ${stale.length} stale permissions`);
  }

  return byKey;
}

async function seedRoles(permissionIdByKey: Map<string, string>) {
  for (const definition of SYSTEM_ROLES) {
    const [existing] = await db
      .select()
      .from(roles)
      .where(eq(roles.key, definition.key))
      .limit(1);

    let roleId = existing?.id;

    if (!roleId) {
      roleId = randomUUID();
      await db.insert(roles).values({
        id: roleId,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        isSystem: true,
        requireTwoFactor: definition.requireTwoFactor,
      });
      console.log(`[seed] + role ${definition.key}`);
    } else {
      await db
        .update(roles)
        .set({
          name: definition.name,
          description: definition.description,
          isSystem: true,
          updatedAt: new Date(),
        })
        .where(eq(roles.id, roleId));
    }

    // Grants are declarative: wipe and rewrite so a removed grant in
    // permissions.ts is actually revoked.
    const wanted = grantsToPermissionKeys(definition.grants)
      .map((key) => permissionIdByKey.get(key))
      .filter((id): id is string => Boolean(id));

    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (wanted.length > 0) {
      await db
        .insert(rolePermissions)
        .values(wanted.map((permissionId) => ({ roleId, permissionId })));
    }
  }
}

/**
 * Creates the super-admin through Better-Auth rather than raw inserts, so the
 * password lands in the exact hash format the sign-in path expects. Importing
 * the auth module here is what forces this script to run under `tsx` with the
 * app's module resolution.
 */
async function seedSuperAdmin(): Promise<string> {
  const { auth } = await import("@/lib/auth");

  const [existing] = await db
    .select()
    .from(userTable)
    .where(eq(userTable.email, env.SEED_ADMIN_EMAIL))
    .limit(1);

  if (existing) {
    // Re-assert the important bits without touching the password.
    await db
      .update(userTable)
      .set({
        role: "super_admin",
        emailVerified: true,
        banned: false,
        banReason: null,
        banExpires: null,
        updatedAt: new Date(),
      })
      .where(eq(userTable.id, existing.id));
    console.log(
      `[seed] = super admin ${env.SEED_ADMIN_EMAIL} (already exists)`,
    );
    return existing.id;
  }

  const created = await auth.api.signUpEmail({
    body: {
      email: env.SEED_ADMIN_EMAIL,
      password: env.SEED_ADMIN_PASSWORD,
      name: env.SEED_ADMIN_NAME,
    },
  });

  const userId = created.user.id;

  await db
    .update(userTable)
    .set({ role: "super_admin", emailVerified: true, updatedAt: new Date() })
    .where(eq(userTable.id, userId));

  const [credential] = await db
    .select()
    .from(accountTable)
    .where(eq(accountTable.userId, userId))
    .limit(1);

  if (!credential) {
    throw new Error(
      "Seed created a user without a credential account — check the Better-Auth email/password config.",
    );
  }

  console.log(
    `[seed] + super admin ${env.SEED_ADMIN_EMAIL} / ${env.SEED_ADMIN_PASSWORD}`,
  );
  return userId;
}

const SAMPLE_FLAGS: {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  rules: FeatureFlagRules;
}[] = [
  {
    key: "new-dashboard-widgets",
    name: "New dashboard widgets",
    description: "Adds the experimental activity widgets to the overview page.",
    enabled: true,
    rules: { rolloutPercentage: 100 },
  },
  {
    key: "bulk-user-import",
    name: "Bulk user import",
    description: "CSV import on the Users page. Staff-only while it settles.",
    enabled: true,
    rules: { includeRoles: ["super_admin", "admin"] },
  },
  {
    key: "audit-log-streaming",
    name: "Audit log streaming",
    description: "Live-tails new audit entries. Rolling out gradually.",
    enabled: true,
    rules: { rolloutPercentage: 25 },
  },
  {
    key: "dangerous-experiment",
    name: "Dangerous experiment",
    description: "Off for everyone. Kept as an example of a killed flag.",
    enabled: false,
    rules: {},
  },
];

async function seedFeatureFlags() {
  for (const flag of SAMPLE_FLAGS) {
    const [existing] = await db
      .select({ id: featureFlags.id })
      .from(featureFlags)
      .where(eq(featureFlags.key, flag.key))
      .limit(1);

    if (existing) continue;

    await db.insert(featureFlags).values({
      id: randomUUID(),
      key: flag.key,
      name: flag.name,
      description: flag.description,
      enabled: flag.enabled,
      rules: flag.rules,
    });
    console.log(`[seed] + flag ${flag.key}`);
  }
}

async function seedAuditLogs(actorId: string) {
  const existing = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .limit(1);
  if (existing.length > 0) return;

  const now = Date.now();
  await db.insert(auditLogs).values([
    {
      id: randomUUID(),
      actorId,
      actorEmail: env.SEED_ADMIN_EMAIL,
      action: "system.seeded",
      resourceType: "system",
      resourceId: null,
      before: null,
      after: { roles: SYSTEM_ROLES.map((role) => role.key) },
      ip: "127.0.0.1",
      userAgent: "pnpm db:seed",
      createdAt: new Date(now - 3 * 60_000),
    },
    {
      id: randomUUID(),
      actorId,
      actorEmail: env.SEED_ADMIN_EMAIL,
      action: "featureFlag.created",
      resourceType: "featureFlag",
      resourceId: "new-dashboard-widgets",
      before: null,
      after: { key: "new-dashboard-widgets", enabled: true },
      ip: "127.0.0.1",
      userAgent: "pnpm db:seed",
      createdAt: new Date(now - 2 * 60_000),
    },
    {
      id: randomUUID(),
      actorId,
      actorEmail: env.SEED_ADMIN_EMAIL,
      action: "featureFlag.toggled",
      resourceType: "featureFlag",
      resourceId: "dangerous-experiment",
      before: { enabled: true },
      after: { enabled: false },
      ip: "127.0.0.1",
      userAgent: "pnpm db:seed",
      createdAt: new Date(now - 60_000),
    },
  ]);
  console.log("[seed] + 3 sample audit log entries");
}

async function main() {
  console.log("[seed] starting …");
  const permissionIdByKey = await syncPermissionCatalog();
  await seedRoles(permissionIdByKey);
  const actorId = await seedSuperAdmin();
  await seedFeatureFlags();
  await seedAuditLogs(actorId);
  console.log("[seed] done");
  console.log("");
  console.log(`    Sign in at ${env.NEXT_PUBLIC_APP_URL}/sign-in`);
  console.log(`    ${env.SEED_ADMIN_EMAIL} / ${env.SEED_ADMIN_PASSWORD}`);
  console.log("");
}

main()
  .catch((error) => {
    console.error("[seed] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
    // The Redis client and pino's worker thread keep the event loop alive, so
    // a script that only closes the pool would hang forever.
    const { getRedis } = await import("@/lib/redis");
    getRedis()?.disconnect();
    process.exit(process.exitCode ?? 0);
  });
