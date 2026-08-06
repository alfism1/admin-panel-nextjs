import { productResource } from "@/modules/products/product.resource";

import type { ResourceDescriptor } from "./define";

/**
 * The resource registry — the one place a new module is registered.
 *
 * Adding a line here is what makes a resource appear in the permission
 * statement, the sidebar, the command palette, the audit-log filter, the
 * Roles matrix and at its own URL. The eight scattered edits a module used to
 * need are all derived from this array.
 *
 * `as const` is load-bearing: `PermissionKey` is a template-literal union built
 * from these names and actions, so losing the literal types here would quietly
 * degrade every permission check in the app to `string`.
 *
 * Isomorphic — descriptors only. The server-side halves live in
 * `registry.server.ts`, which is what keeps Drizzle out of the client bundle.
 */
export const resources = [productResource] as const;

export type Resources = typeof resources;
export type RegisteredResource = Resources[number];

/** `"product"` — the union of every registered resource name. */
export type ResourceName = RegisteredResource["name"];

/** The `{ product: ["create", "read", …] }` slice of the permission statement. */
export type ResourceStatement = {
  [R in RegisteredResource as R["name"]]: R["actions"];
};

export const resourceStatement = Object.fromEntries(
  resources.map((resource) => [resource.name, resource.actions]),
) as ResourceStatement;

/** `"product.created" | "product.archived" | …`, for the audit-log enum. */
export type ResourceAuditAction = {
  [R in RegisteredResource as R["name"]]:
    | `${R["name"]}.created`
    | `${R["name"]}.updated`
    | `${R["name"]}.deleted`
    | ("archive" extends R["actions"][number]
        ? `${R["name"]}.archived` | `${R["name"]}.unarchived`
        : never);
}[ResourceName];

export const resourceAuditActions = resources.flatMap(
  (resource) => resource.auditActions,
) as ResourceAuditAction[];

export const resourceCacheTags = resources.map((resource) => resource.cacheTag);

const byName = new Map<string, ResourceDescriptor>(
  resources.map((resource) => [resource.name, resource]),
);

const bySegment = new Map<string, ResourceDescriptor>(
  resources.map((resource) => [resource.segment, resource]),
);

/** `undefined` for an unknown name — callers turn that into a 404 or a refusal. */
export function findResource(name: string): ResourceDescriptor | undefined {
  return byName.get(name);
}

/** Resolves the `[resource]` URL segment, e.g. `products` → the descriptor. */
export function findResourceBySegment(
  segment: string,
): ResourceDescriptor | undefined {
  return bySegment.get(segment);
}

export function getResource(name: string): ResourceDescriptor {
  const resource = byName.get(name);
  if (!resource) throw new Error(`Unknown resource "${name}".`);
  return resource;
}
