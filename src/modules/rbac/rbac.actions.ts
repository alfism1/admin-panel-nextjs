"use server";

import { revalidatePath } from "next/cache";

import { withAction, type ActionResult } from "@/lib/action";

import { rbacService } from "./rbac.service";

/**
 * Server Actions for role management.
 *
 * Thin by design: parse nothing, decide nothing, just call the service and
 * translate the outcome. Every authorization and validation rule lives in
 * `rbac.service.ts`, so a Route Handler or a background job doing the same
 * thing gets the same guarantees.
 */

export async function createRoleAction(
  input: unknown,
): Promise<ActionResult<{ id: string; key: string }>> {
  return withAction("rbac.createRole", async () => {
    const role = await rbacService.create(input);
    revalidatePath("/roles");
    return { id: role.id, key: role.key };
  });
}

export async function updateRoleAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return withAction("rbac.updateRole", async () => {
    const role = await rbacService.update(input);
    revalidatePath("/roles");
    return { id: role.id };
  });
}

export async function updateRolePermissionsAction(
  input: unknown,
): Promise<ActionResult<{ id: string; permissionKeys: string[] }>> {
  return withAction("rbac.updateRolePermissions", async () => {
    const role = await rbacService.updatePermissions(input);
    revalidatePath("/roles");
    // Permissions changed for everyone holding this role — the shells they
    // have rendered are now stale.
    revalidatePath("/", "layout");
    return { id: role.id, permissionKeys: role.permissionKeys };
  });
}

export async function deleteRoleAction(
  input: unknown,
): Promise<ActionResult<void>> {
  return withAction("rbac.deleteRole", async () => {
    await rbacService.remove(input);
    revalidatePath("/roles");
  });
}
