import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/db/client";
import {
  session as sessionTable,
  user as userTable,
  type UserRow,
} from "@/db/schema";

import type { ListUsersInput } from "./users.schema";

/**
 * User data access.
 *
 * Note what is *not* here: creating a user with a password. That has to go
 * through Better-Auth (`auth.api.*`) so the hash format matches what sign-in
 * verifies — see `users.service.ts`. This layer owns reads, role assignment and
 * profile fields only.
 */

/** The shape sent to the client. Never includes anything credential-shaped. */
export interface UserListItem {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  roleKeys: string[];
  banned: boolean;
  banReason: string | null;
  banExpires: Date | null;
  twoFactorEnabled: boolean;
  createdAt: Date;
}

function toListItem(row: UserRow): UserListItem {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.image,
    roleKeys: splitRoles(row.role),
    banned: isActivelyBanned(row),
    banReason: row.banReason,
    banExpires: row.banExpires,
    twoFactorEnabled: row.twoFactorEnabled,
    createdAt: row.createdAt,
  };
}

export function splitRoles(role: string | null): string[] {
  if (!role) return [];
  return role
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

/** A ban whose expiry has passed is no longer a ban. */
function isActivelyBanned(
  row: Pick<UserRow, "banned" | "banExpires">,
): boolean {
  if (!row.banned) return false;
  if (!row.banExpires) return true;
  return row.banExpires.getTime() > Date.now();
}

const SORT_COLUMNS = {
  name: userTable.name,
  email: userTable.email,
  createdAt: userTable.createdAt,
} as const;

function buildWhere(input: ListUsersInput): SQL | undefined {
  const clauses: SQL[] = [];

  const term = input.search.trim();
  if (term) {
    const pattern = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const searchClause = or(
      ilike(userTable.name, pattern),
      ilike(userTable.email, pattern),
    );
    if (searchClause) clauses.push(searchClause);
  }

  if (input.role) {
    // `users.role` is comma-separated, so an exact match isn't enough: wrap
    // both sides in commas to match a whole key without matching `admin` inside
    // `super_admin`.
    clauses.push(
      sql`',' || coalesce(${userTable.role}, '') || ',' like ${`%,${input.role},%`}`,
    );
  }

  if (input.status === "banned") {
    clauses.push(
      and(
        eq(userTable.banned, true),
        or(isNull(userTable.banExpires), gt(userTable.banExpires, new Date())),
      ) as SQL,
    );
  } else if (input.status === "unverified") {
    clauses.push(eq(userTable.emailVerified, false));
  } else if (input.status === "active") {
    clauses.push(eq(userTable.banned, false));
  }

  if (clauses.length === 0) return undefined;
  return and(...clauses);
}

async function list(
  input: ListUsersInput,
): Promise<{ rows: UserListItem[]; total: number }> {
  const where = buildWhere(input);
  const column = SORT_COLUMNS[input.sort];
  const orderBy = input.order === "asc" ? asc(column) : desc(column);

  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(userTable)
      .where(where)
      .orderBy(orderBy)
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db.select({ value: count() }).from(userTable).where(where),
  ]);

  return { rows: rows.map(toListItem), total: totals?.value ?? 0 };
}

async function findById(id: string): Promise<UserListItem | null> {
  const [row] = await db
    .select()
    .from(userTable)
    .where(eq(userTable.id, id))
    .limit(1);
  return row ? toListItem(row) : null;
}

async function findRawById(id: string): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(userTable)
    .where(eq(userTable.id, id))
    .limit(1);
  return row ?? null;
}

async function findByEmail(email: string): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1);
  return row ?? null;
}

async function findManyByIds(ids: string[]): Promise<UserListItem[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(userTable)
    .where(inArray(userTable.id, ids));
  return rows.map(toListItem);
}

async function updateProfile(
  id: string,
  values: Partial<{ name: string; email: string; emailVerified: boolean }>,
): Promise<UserRow | null> {
  const [row] = await db
    .update(userTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(userTable.id, id))
    .returning();
  return row ?? null;
}

async function setRoles(
  id: string,
  roleKeys: string[],
): Promise<UserRow | null> {
  const [row] = await db
    .update(userTable)
    .set({
      role: roleKeys.length > 0 ? roleKeys.join(",") : null,
      updatedAt: new Date(),
    })
    .where(eq(userTable.id, id))
    .returning();
  return row ?? null;
}

async function countActiveSessions(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(sessionTable)
    .where(
      and(
        eq(sessionTable.userId, userId),
        gt(sessionTable.expiresAt, new Date()),
      ),
    );
  return row?.value ?? 0;
}

async function listActiveSessions(userId: string) {
  return db
    .select({
      id: sessionTable.id,
      createdAt: sessionTable.createdAt,
      expiresAt: sessionTable.expiresAt,
      ipAddress: sessionTable.ipAddress,
      userAgent: sessionTable.userAgent,
      impersonatedBy: sessionTable.impersonatedBy,
    })
    .from(sessionTable)
    .where(
      and(
        eq(sessionTable.userId, userId),
        gt(sessionTable.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(sessionTable.createdAt));
}

async function stats(): Promise<{
  total: number;
  banned: number;
  unverified: number;
}> {
  const [[total], [banned], [unverified]] = await Promise.all([
    db.select({ value: count() }).from(userTable),
    db
      .select({ value: count() })
      .from(userTable)
      .where(eq(userTable.banned, true)),
    db
      .select({ value: count() })
      .from(userTable)
      .where(eq(userTable.emailVerified, false)),
  ]);

  return {
    total: total?.value ?? 0,
    banned: banned?.value ?? 0,
    unverified: unverified?.value ?? 0,
  };
}

/** Sample of users for the feature-flag "who is this on for" preview. */
async function sampleForPreview(limit = 12) {
  const rows = await db
    .select({
      id: userTable.id,
      email: userTable.email,
      role: userTable.role,
    })
    .from(userTable)
    .orderBy(desc(userTable.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    roleKeys: splitRoles(row.role),
  }));
}

export const usersRepository = {
  list,
  findById,
  findRawById,
  findByEmail,
  findManyByIds,
  updateProfile,
  setRoles,
  countActiveSessions,
  listActiveSessions,
  stats,
  sampleForPreview,
};
