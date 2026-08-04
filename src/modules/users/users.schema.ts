import { z } from "zod";

import { emailField, passwordField } from "@/modules/auth/auth.schema";

export const listUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["name", "email", "createdAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().trim().max(200).default(""),
  role: z.string().trim().max(64).optional(),
  status: z.enum(["active", "banned", "unverified"]).optional(),
});
export type ListUsersInput = z.infer<typeof listUsersSchema>;

export const createUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  email: emailField,
  password: passwordField,
  /** Role key. Empty means "the default role". */
  role: z.string().trim().max(64).optional(),
  /** Skip the verification e-mail — for accounts an admin creates directly. */
  markVerified: z.boolean(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required.").max(120),
  email: emailField,
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const assignRoleSchema = z.object({
  id: z.string().min(1),
  /** Role keys. An empty array strips every role. */
  roleKeys: z.array(z.string().trim().min(1).max(64)).max(10),
});
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

export const banUserSchema = z.object({
  id: z.string().min(1),
  reason: z
    .string()
    .trim()
    .min(1, "Give a reason — it goes in the audit log.")
    .max(500),
  /** Days until the ban lifts. Omit for indefinite. */
  expiresInDays: z.coerce.number().int().min(1).max(3650).optional(),
});
export type BanUserInput = z.infer<typeof banUserSchema>;

export const userIdSchema = z.object({ id: z.string().min(1) });

export const setPasswordSchema = z.object({
  id: z.string().min(1),
  password: passwordField,
});
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

export const bulkUserActionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});
export type BulkUserActionInput = z.infer<typeof bulkUserActionSchema>;
