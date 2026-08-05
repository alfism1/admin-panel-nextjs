import { z } from "zod";

/**
 * Audit action vocabulary.
 *
 * A closed set rather than free-form strings: the filter dropdown is generated
 * from it, and a typo in `"user.bannned"` would otherwise create a silent
 * second category nobody ever filters for.
 */
export const AUDIT_ACTIONS = [
  "auth.signed_in",
  "auth.signed_out",
  "auth.sign_in_failed",
  "auth.password_reset_requested",
  "auth.password_changed",
  "auth.email_verified",
  "auth.two_factor_enabled",
  "auth.two_factor_disabled",

  "user.created",
  "user.updated",
  "user.deleted",
  "user.banned",
  "user.unbanned",
  "user.role_changed",
  "user.password_set",
  "user.sessions_revoked",
  "user.impersonation_started",
  "user.impersonation_stopped",

  "role.created",
  "role.updated",
  "role.deleted",
  "role.permissions_updated",

  "featureFlag.created",
  "featureFlag.updated",
  "featureFlag.deleted",
  "featureFlag.toggled",

  "auditLog.exported",
  "auditLog.purged",

  "system.seeded",

  "product.created",
  "product.updated",
  "product.deleted",
  "product.archived",
  "product.unarchived",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_RESOURCE_TYPES = [
  "user",
  "role",
  "featureFlag",
  "session",
  "auditLog",
  "system",
  "product",
] as const;

export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

export const listAuditLogsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["createdAt", "action", "actorEmail"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  /** Free-text across actor e-mail and resource id. */
  search: z.string().trim().max(200).default(""),
  actorId: z.string().trim().max(100).optional(),
  action: z.string().trim().max(100).optional(),
  resourceType: z.string().trim().max(50).optional(),
  /** ISO date (`YYYY-MM-DD`), inclusive. */
  from: z.string().trim().max(30).optional(),
  to: z.string().trim().max(30).optional(),
});

export type ListAuditLogsInput = z.infer<typeof listAuditLogsSchema>;

export const exportAuditLogsSchema = listAuditLogsSchema.omit({
  page: true,
  pageSize: true,
});

export type ExportAuditLogsInput = z.infer<typeof exportAuditLogsSchema>;
