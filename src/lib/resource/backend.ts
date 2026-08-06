import "server-only";

import type { PgTable } from "drizzle-orm/pg-core";

import type { ResourceDescriptor } from "./define";
import {
  createResourceRepository,
  type ResourceRepository,
} from "./repository";
import {
  createResourceService,
  type ResourceRules,
  type ResourceService,
} from "./service";

/**
 * The server half of a resource: descriptor + Drizzle table → repository and
 * service.
 *
 * Kept apart from the descriptor because the descriptor is isomorphic and this
 * is not. Importing a Drizzle table from anything the browser can reach drags
 * `drizzle-orm/pg-core` into the client bundle, so the split is a bundling
 * boundary rather than a stylistic one.
 */
export interface ResourceBackend {
  descriptor: ResourceDescriptor;
  repository: ResourceRepository;
  service: ResourceService;
}

export function createResourceBackend(
  descriptor: ResourceDescriptor,
  options: {
    table: PgTable;
    /** Escape hatch for logic the descriptor can't express. */
    rules?: ResourceRules;
    /** Overrides the count cap that picks the search plan. */
    matchCap?: number;
  },
): ResourceBackend {
  const repository = createResourceRepository(descriptor, {
    table: options.table,
    matchCap: options.matchCap,
  });
  const service = createResourceService(descriptor, {
    repository,
    rules: options.rules,
  });

  return { descriptor, repository, service };
}
