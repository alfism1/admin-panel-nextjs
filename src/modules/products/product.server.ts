import "server-only";

import { products } from "@/db/schema";
import { createResourceBackend } from "@/lib/resource/backend";

import { productResource } from "./product.resource";

/**
 * The server half of the products module.
 *
 * Binds the descriptor to its Drizzle table. There are no `rules` here because
 * the one business rule products had — "a SKU may not be reused" — is now the
 * `unique: true` on the field, enforced by the service for every resource.
 *
 * Custom logic goes in `rules` (`beforeCreate`, `beforeUpdate`, `beforeDelete`,
 * `snapshot`) when a resource needs something the descriptor can't express.
 */
export const productBackend = createResourceBackend(productResource, {
  table: products,
});

export const productsService = productBackend.service;
export const productsRepository = productBackend.repository;
