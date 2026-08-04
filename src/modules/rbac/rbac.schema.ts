import { z } from "zod";

import { ALL_PERMISSION_KEYS } from "@/lib/permissions";

/** Role keys end up in `users.role`, a comma-separated column — no commas. */
export const roleKeySchema = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters.")
  .max(64, "Use at most 64 characters.")
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Lowercase letters, digits and underscores only, starting with a letter (e.g. support_agent).",
  );

/**
 * Only keys that exist in the statement are accepted. Without this the matrix
 * could persist a grant for an action nothing ever checks — a permission that
 * looks granted and does nothing.
 */
const permissionKeySchema = z
  .string()
  .refine((key) => (ALL_PERMISSION_KEYS as string[]).includes(key), {
    message: "Unknown permission.",
  });

export const createRoleSchema = z.object({
  key: roleKeySchema,
  name: z.string().trim().min(1, "Name is required.").max(120),
  description: z.string().trim().max(500).optional(),
  requireTwoFactor: z.boolean(),
  permissionKeys: z.array(permissionKeySchema).max(200),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required.").max(120),
  description: z.string().trim().max(500).optional(),
  requireTwoFactor: z.boolean(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const updateRolePermissionsSchema = z.object({
  id: z.string().min(1),
  permissionKeys: z.array(permissionKeySchema).max(200),
});
export type UpdateRolePermissionsInput = z.infer<
  typeof updateRolePermissionsSchema
>;

export const roleIdSchema = z.object({ id: z.string().min(1) });
