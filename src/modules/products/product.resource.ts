import { Package } from "lucide-react";
import { z } from "zod";

import { defineResource } from "@/lib/resource/define";
import { field } from "@/lib/resource/fields";

/**
 * Products.
 *
 * The whole module: permissions, navigation, audit actions, cache tags,
 * validation, the repository, the service, the Server Actions, the page, the
 * table and the form are all derived from this declaration plus the Drizzle
 * table in `db/schema/products.ts`.
 *
 * Isomorphic — this file is reachable from the browser, so it must not import
 * the Drizzle table. That binding lives in `product.server.ts`.
 */

/** Exported because the seed script builds SKUs and should validate them the same way. */
export const skuField = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, "Uppercase letters, digits and hyphens only.");

export const productResource = defineResource({
  name: "product",
  route: "/products",
  icon: Package,
  nav: {
    group: "Product",
    description: "Catalogue, pricing and availability",
  },
  description:
    "The catalogue. Actions you can't perform are hidden here and re-checked on the server.",
  // Adds the `product:archive` permission, the status column and filter, and
  // the archive/restore row actions — so someone trusted to pull a product off
  // the shelf still can't rewrite its price.
  archivable: true,
  primaryField: "name",
  secondaryField: "sku",
  searchPlaceholder: "Search by SKU or name…",
  emptyTitle: "No products yet",
  emptyDescription: "Add the first one, or import your catalogue.",
  fields: {
    sku: field.text({
      label: "SKU",
      schema: skuField,
      // Fixed once a product exists — other systems reference it.
      immutable: true,
      unique: true,
      searchable: true,
      placeholder: "TSHIRT-BLK-M",
      description: "Uppercase letters, digits and hyphens.",
    }),
    name: field.text({
      label: "Name",
      max: 160,
      searchable: true,
    }),
    priceCents: field.money({
      label: "Price",
      currency: "USD",
      placeholder: "19.99",
      description: "Stored as an integer number of cents.",
    }),
    description: field.textarea({
      label: "Description",
      max: 2000,
      optional: true,
      inTable: false,
      placeholder: "What it is, in a sentence or two.",
    }),
  },
});
