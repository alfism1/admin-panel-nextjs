import "server-only";

import { productBackend } from "@/modules/products/product.server";

import type { ResourceBackend } from "./backend";

/**
 * The server-side registry: the second and last line a new module adds.
 *
 * Separate from `registry.ts` because everything reachable from that one ends
 * up in the browser bundle. Backends hold Drizzle tables, so they are only ever
 * imported from Server Components, Server Actions and Route Handlers.
 */
const backends: ResourceBackend[] = [productBackend];

const byName = new Map(
  backends.map((backend) => [backend.descriptor.name, backend]),
);

const bySegment = new Map(
  backends.map((backend) => [backend.descriptor.segment, backend]),
);

export function findBackend(name: string): ResourceBackend | undefined {
  return byName.get(name);
}

export function findBackendBySegment(
  segment: string,
): ResourceBackend | undefined {
  return bySegment.get(segment);
}

export { backends };
