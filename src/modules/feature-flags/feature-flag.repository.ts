import "server-only";

import { asc, count, eq, ilike, ne, or, and, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import { newId } from "@/db/id";
import {
  featureFlags,
  type FeatureFlagRow,
  type FeatureFlagRules,
} from "@/db/schema";

async function list(search = ""): Promise<FeatureFlagRow[]> {
  let where: SQL | undefined;

  const term = search.trim();
  if (term) {
    const pattern = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    where = or(
      ilike(featureFlags.key, pattern),
      ilike(featureFlags.name, pattern),
      ilike(featureFlags.description, pattern),
    );
  }

  return db
    .select()
    .from(featureFlags)
    .where(where)
    .orderBy(asc(featureFlags.key));
}

async function findByKey(key: string): Promise<FeatureFlagRow | null> {
  const [row] = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.key, key))
    .limit(1);
  return row ?? null;
}

async function findById(id: string): Promise<FeatureFlagRow | null> {
  const [row] = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.id, id))
    .limit(1);
  return row ?? null;
}

async function isKeyTaken(key: string, exceptId?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: featureFlags.id })
    .from(featureFlags)
    .where(
      exceptId
        ? and(eq(featureFlags.key, key), ne(featureFlags.id, exceptId))
        : eq(featureFlags.key, key),
    )
    .limit(1);
  return Boolean(row);
}

async function insert(values: {
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  rules: FeatureFlagRules;
}): Promise<FeatureFlagRow> {
  const [row] = await db
    .insert(featureFlags)
    .values({ id: newId(), ...values })
    .returning();
  if (!row) throw new Error("Insert into feature_flags returned no row.");
  return row;
}

async function update(
  id: string,
  values: Partial<{
    name: string;
    description: string | null;
    enabled: boolean;
    rules: FeatureFlagRules;
  }>,
): Promise<FeatureFlagRow | null> {
  const [row] = await db
    .update(featureFlags)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(featureFlags.id, id))
    .returning();
  return row ?? null;
}

async function remove(id: string): Promise<void> {
  await db.delete(featureFlags).where(eq(featureFlags.id, id));
}

async function stats(): Promise<{ total: number; enabled: number }> {
  const [[total], [enabled]] = await Promise.all([
    db.select({ value: count() }).from(featureFlags),
    db
      .select({ value: count() })
      .from(featureFlags)
      .where(eq(featureFlags.enabled, true)),
  ]);
  return { total: total?.value ?? 0, enabled: enabled?.value ?? 0 };
}

export const featureFlagRepository = {
  list,
  findByKey,
  findById,
  isKeyTaken,
  insert,
  update,
  remove,
  stats,
};
