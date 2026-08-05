import { z } from "zod";

export const listProductsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["name", "sku", "priceCents", "createdAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().trim().max(200).default(""),
  status: z.enum(["active", "archived"]).optional(),
});
export type ListProductsInput = z.infer<typeof listProductsSchema>;

export const skuField = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, "Uppercase letters, digits and hyphens only.");

export const createProductSchema = z.object({
  sku: skuField,
  name: z.string().trim().min(1, "Name is required.").max(160),
  description: z.string().trim().max(2000).optional(),
  priceCents: z.number().int().min(0).max(100_000_000),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema
  .omit({ sku: true }) // SKU is immutable after creation
  .extend({ id: z.string().min(1) });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productIdSchema = z.object({ id: z.string().min(1) });
export const archiveProductSchema = z.object({
  id: z.string().min(1),
  archived: z.boolean(),
});
