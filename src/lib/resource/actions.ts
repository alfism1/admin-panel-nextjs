"use server";

import { revalidatePath } from "next/cache";

import { withAction, type ActionResult } from "@/lib/action";
import { BadRequestError } from "@/lib/errors";

import { findBackend } from "./registry.server";

/**
 * One Server Action for every resource.
 *
 * A `"use server"` module may only export async functions, and its exports are
 * what the compiler turns into addressable endpoints — so a registry cannot
 * generate a `createProductAction` per resource the way Laravel generates a
 * controller. It exports a dispatcher instead, which is also how Filament does
 * it: one endpoint, the resource named in the payload.
 *
 * That makes `resource` and `operation` attacker-controlled, so neither is
 * trusted. `findBackend` rejects anything not in the registry, and the service
 * behind it runs the same `requirePermission` a hand-written action would —
 * naming a resource you may not touch gets you a `FORBIDDEN`, not access to it.
 * The revalidated path comes from the descriptor, never from the caller.
 */

type Operation = "create" | "update" | "archive" | "delete";

const OPERATIONS: readonly Operation[] = [
  "create",
  "update",
  "archive",
  "delete",
];

export async function resourceMutate(
  resource: string,
  operation: string,
  input: unknown,
): Promise<ActionResult<{ id: string | null; archived?: boolean }>> {
  return withAction(`${resource}.${operation}`, async () => {
    const backend = findBackend(resource);
    if (!backend) throw new BadRequestError(`Unknown resource "${resource}".`);

    if (!OPERATIONS.includes(operation as Operation)) {
      throw new BadRequestError(`Unsupported operation "${operation}".`);
    }

    const { descriptor, service } = backend;

    switch (operation as Operation) {
      case "create": {
        const row = await service.create(input);
        revalidatePath(descriptor.route);
        return { id: row.id };
      }
      case "update": {
        const row = await service.update(input);
        revalidatePath(descriptor.route);
        return { id: row.id };
      }
      case "archive": {
        const row = await service.archive(input);
        revalidatePath(descriptor.route);
        return { id: row.id, archived: Boolean(row.archived) };
      }
      case "delete": {
        await service.remove(input);
        revalidatePath(descriptor.route);
        return { id: null };
      }
    }
  });
}
