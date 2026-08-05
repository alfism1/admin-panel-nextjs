"use server";

import { revalidatePath } from "next/cache";

import { withAction, type ActionResult } from "@/lib/action";

import { productsService } from "./products.service";

/**
 * Server Actions for the Products module.
 *
 * Thin by design: authorising, validating, auditing and cache invalidation all
 * happen in the service, so these only translate its result into something a
 * form can render and tell Next which routes went stale.
 *
 * Each returns the minimum the caller needs — an id, not the row. Everything
 * returned here crosses the network on every call.
 */

export async function createProductAction(
  input: unknown,
): Promise<ActionResult<{ id: string; sku: string }>> {
  return withAction("products.create", async () => {
    const product = await productsService.create(input);
    revalidatePath("/products");
    return { id: product.id, sku: product.sku };
  });
}

export async function updateProductAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return withAction("products.update", async () => {
    const product = await productsService.update(input);
    revalidatePath("/products");
    return { id: product.id };
  });
}

/**
 * Archiving is its own action rather than `update` with a flag set: it carries
 * its own permission (`product:archive`), so someone trusted to pull a product
 * off the shelf still can't rewrite its price.
 */
export async function archiveProductAction(
  input: unknown,
): Promise<ActionResult<{ id: string; archived: boolean }>> {
  return withAction("products.archive", async () => {
    const product = await productsService.archive(input);
    revalidatePath("/products");
    return { id: product.id, archived: product.archived };
  });
}

export async function deleteProductAction(
  input: unknown,
): Promise<ActionResult<void>> {
  return withAction("products.delete", async () => {
    await productsService.remove(input);
    revalidatePath("/products");
  });
}
