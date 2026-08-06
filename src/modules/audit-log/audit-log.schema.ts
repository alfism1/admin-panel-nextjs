import { z } from "zod";

import {
  resourceAuditActions,
  resources,
  type ResourceAuditAction,
  type ResourceName,
} from "@/lib/resource/registry";

/**
 * Audit action vocabulary.
 *
 * A closed set rather than free-form strings: the filter dropdown is generated
 * from it, and a typo in `"user.bannned"` would otherwise create a silent
 * second category nobody ever filters for.
 *
 * Split in two. These are the hand-written actions for the modules that predate
 * the resource registry; a registered resource contributes its own below, so
 * `"product.archvied"` is now unspellable rather than merely discouraged.
 */
const CORE_AUDIT_ACTIONS = [
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
] as const;

const CORE_RESOURCE_TYPES = [
  "user",
  "role",
  "featureFlag",
  "session",
  "auditLog",
  "system",
] as const;

export const AUDIT_ACTIONS: readonly AuditAction[] = [
  ...CORE_AUDIT_ACTIONS,
  ...resourceAuditActions,
];

export type AuditAction =
  (typeof CORE_AUDIT_ACTIONS)[number] | ResourceAuditAction;

export const AUDIT_RESOURCE_TYPES: readonly AuditResourceType[] = [
  ...CORE_RESOURCE_TYPES,
  ...resources.map((resource) => resource.name),
];

export type AuditResourceType =
  (typeof CORE_RESOURCE_TYPES)[number] | ResourceName;

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
