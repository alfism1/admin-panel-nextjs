"use server";

import { revalidatePath } from "next/cache";

import { withAction, type ActionResult } from "@/lib/action";

import { usersService } from "./users.service";

/**
 * Server Actions for the Users module. The reference implementation other
 * modules copy: authorise + validate + audit in the service, translate here.
 */

export async function createUserAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return withAction("users.create", async () => {
    const user = await usersService.create(input);
    revalidatePath("/users");
    return { id: user.id };
  });
}

export async function updateUserAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return withAction("users.update", async () => {
    const user = await usersService.update(input);
    revalidatePath("/users");
    revalidatePath(`/users/${user.id}`);
    return { id: user.id };
  });
}

export async function assignRolesAction(
  input: unknown,
): Promise<ActionResult<{ id: string; roleKeys: string[] }>> {
  return withAction("users.assignRoles", async () => {
    const user = await usersService.assignRoles(input);
    revalidatePath("/users");
    revalidatePath(`/users/${user.id}`);
    // Their permission set changed; the shell they rendered is stale.
    revalidatePath("/", "layout");
    return { id: user.id, roleKeys: user.roleKeys };
  });
}

export async function banUserAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return withAction("users.ban", async () => {
    const user = await usersService.ban(input);
    revalidatePath("/users");
    revalidatePath(`/users/${user.id}`);
    return { id: user.id };
  });
}

export async function unbanUserAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return withAction("users.unban", async () => {
    const user = await usersService.unban(input);
    revalidatePath("/users");
    revalidatePath(`/users/${user.id}`);
    return { id: user.id };
  });
}

export async function deleteUserAction(
  input: unknown,
): Promise<ActionResult<void>> {
  return withAction("users.delete", async () => {
    await usersService.remove(input);
    revalidatePath("/users");
  });
}

export async function setUserPasswordAction(
  input: unknown,
): Promise<ActionResult<void>> {
  return withAction("users.setPassword", async () => {
    await usersService.setPassword(input);
  });
}

export async function revokeUserSessionsAction(
  input: unknown,
): Promise<ActionResult<void>> {
  return withAction("users.revokeSessions", async () => {
    await usersService.revokeSessions(input);
    revalidatePath("/users");
  });
}

export async function impersonateUserAction(
  input: unknown,
): Promise<ActionResult<void>> {
  return withAction("users.impersonate", async () => {
    await usersService.impersonate(input);
    // The whole app now renders as somebody else.
    revalidatePath("/", "layout");
  });
}

export async function bulkBanUsersAction(
  input: unknown,
  reason: string,
): Promise<ActionResult<{ banned: number }>> {
  return withAction("users.bulkBan", async () => {
    const banned = await usersService.bulkBan(input, reason);
    revalidatePath("/users");
    return { banned };
  });
}
