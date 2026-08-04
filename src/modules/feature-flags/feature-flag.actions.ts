"use server";

import { revalidatePath } from "next/cache";

import { withAction, type ActionResult } from "@/lib/action";

import { featureFlagService } from "./feature-flag.service";

export async function createFeatureFlagAction(
  input: unknown,
): Promise<ActionResult<{ id: string; key: string }>> {
  return withAction("featureFlags.create", async () => {
    const flag = await featureFlagService.create(input);
    revalidatePath("/feature-flags");
    return { id: flag.id, key: flag.key };
  });
}

export async function updateFeatureFlagAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return withAction("featureFlags.update", async () => {
    const flag = await featureFlagService.update(input);
    revalidatePath("/feature-flags");
    return { id: flag.id };
  });
}

/**
 * The toggle is its own action, not `update` with a different payload: it has
 * its own permission (`featureFlag:toggle`) so an on-call engineer can kill a
 * flag without being able to edit rollout rules.
 */
export async function toggleFeatureFlagAction(
  input: unknown,
): Promise<ActionResult<{ id: string; enabled: boolean }>> {
  return withAction("featureFlags.toggle", async () => {
    const flag = await featureFlagService.toggle(input);
    revalidatePath("/feature-flags");
    // The flag may gate UI anywhere in the app.
    revalidatePath("/", "layout");
    return { id: flag.id, enabled: flag.enabled };
  });
}

export async function deleteFeatureFlagAction(
  input: unknown,
): Promise<ActionResult<void>> {
  return withAction("featureFlags.delete", async () => {
    await featureFlagService.remove(input);
    revalidatePath("/feature-flags");
  });
}
