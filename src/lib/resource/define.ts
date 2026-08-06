import type { LucideIcon } from "lucide-react";
import { z } from "zod";

import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/lib/table-params";

import type { FieldDescriptor } from "./fields";

/**
 * `defineResource` — one declaration, from which a whole module is derived.
 *
 * What used to be eight hand-written files is now this call plus a Drizzle
 * table. The permission statement, navigation entry, audit action names, cache
 * tags, zod schemas, repository, service, Server Actions, page, table and form
 * are all read off the returned descriptor.
 *
 * Isomorphic, and it has to stay that way: `lib/permissions.ts` and the nav
 * config are imported by Client Components, so anything reachable from here
 * ends up in the browser bundle. The Drizzle table and the business rules live
 * in the module's `*.server.ts` for exactly that reason.
 */

/** Every resource gets these four. `archive` and any extras are added on top. */
type BaseAction = "create" | "read" | "update" | "delete";

export type ActionsOf<
  TArchivable extends boolean,
  TExtra extends readonly string[],
> = TArchivable extends true
  ? readonly ["create", "read", "update", "delete", "archive", ...TExtra]
  : readonly ["create", "read", "update", "delete", ...TExtra];

export type AuditActionsOf<TName extends string, TArchivable extends boolean> =
  | `${TName}.created`
  | `${TName}.updated`
  | `${TName}.deleted`
  | (TArchivable extends true
      ? `${TName}.archived` | `${TName}.unarchived`
      : never);

/** A row as it crosses the server → client boundary: JSON, with a string id. */
export type ResourceRecord = Record<string, unknown> & { id: string };

export interface ResourceFilter {
  name: string;
  label: string;
  options: { value: string; label: string }[];
}

export interface ResourceConfig<
  TName extends string,
  TArchivable extends boolean,
  TExtra extends readonly string[],
> {
  /** Singular, camelCase. Becomes the permission resource and audit prefix. */
  name: TName;
  /** Human singular, e.g. "Product". Defaults to a title-cased `name`. */
  label?: string;
  /** Human plural, e.g. "Products". Defaults to `label` + "s". */
  pluralLabel?: string;
  /** URL path, e.g. `/products`. */
  route: string;
  icon: LucideIcon;
  /** Sidebar placement. `null` hides the resource from navigation. */
  nav?: { group: string; description: string } | null;
  /** Page-header blurb. */
  description?: string;
  /**
   * Adds the `archive` permission, an archived/active column, a status filter
   * and archive/restore row actions.
   *
   * Split from `update` on purpose: archiving is the thing you delegate to
   * someone you would not trust to rewrite prices.
   */
  archivable?: TArchivable;
  /** Permission actions beyond the generated set (`export`, `publish`, …). */
  extraActions?: TExtra;
  fields: Record<string, FieldDescriptor>;
  /** Field shown as the row's headline. Defaults to the first field. */
  primaryField?: string;
  /** Field shown under the headline, and typed to confirm a delete. */
  secondaryField?: string;
  defaultSort?: string;
  defaultOrder?: "asc" | "desc";
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}

export interface ResourceDescriptor<
  TName extends string = string,
  TActions extends readonly string[] = readonly string[],
> {
  name: TName;
  actions: TActions;
  label: string;
  pluralLabel: string;
  route: string;
  /** The URL segment, e.g. `products`. Used by the catch-all route. */
  segment: string;
  icon: LucideIcon;
  nav: { group: string; description: string } | null;
  description: string;
  archivable: boolean;
  fields: Record<string, FieldDescriptor>;
  fieldEntries: [string, FieldDescriptor][];
  primaryField: string;
  secondaryField: string | null;
  /** Fields the search box matches on. */
  searchFields: string[];
  searchPlaceholder: string;
  sortKeys: string[];
  defaultSort: string;
  defaultOrder: "asc" | "desc";
  uniqueFields: string[];
  filters: ResourceFilter[];
  emptyTitle: string;
  emptyDescription: string;
  /** Validated payloads. The service parses these; the form builds its own. */
  createSchema: z.ZodType;
  updateSchema: z.ZodType;
  listSchema: z.ZodType;
  idSchema: z.ZodType;
  archiveSchema: z.ZodType;
  permissionKeys: string[];
  auditActions: string[];
  /** Invalidation tag for the collection, and for one record. */
  cacheTag: string;
  recordCacheTag: (id: string) => string;
}

const BASE_ACTIONS: readonly BaseAction[] = [
  "create",
  "read",
  "update",
  "delete",
];

function titleCase(value: string): string {
  const spaced = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function defineResource<
  const TName extends string,
  const TArchivable extends boolean = false,
  const TExtra extends readonly string[] = readonly [],
>(
  config: ResourceConfig<TName, TArchivable, TExtra>,
): ResourceDescriptor<TName, ActionsOf<TArchivable, TExtra>> {
  const fieldEntries = Object.entries(config.fields);
  if (fieldEntries.length === 0) {
    throw new Error(`Resource "${config.name}" declares no fields.`);
  }

  const archivable = Boolean(config.archivable);
  const label = config.label ?? titleCase(config.name);
  const pluralLabel = config.pluralLabel ?? `${label}s`;

  const actions = [
    ...BASE_ACTIONS,
    ...(archivable ? (["archive"] as const) : []),
    ...(config.extraActions ?? []),
  ] as unknown as ActionsOf<TArchivable, TExtra>;

  const primaryField = config.primaryField ?? fieldEntries[0]![0];
  const secondaryField = config.secondaryField ?? null;

  const searchFields = fieldEntries
    .filter(([, field]) => field.searchable)
    .map(([name]) => name);

  // `createdAt` is always sortable: the framework adds the column, so it must
  // also add its sort key or the header would be a dead button.
  const sortKeys = [
    ...fieldEntries.filter(([, field]) => field.sortable).map(([name]) => name),
    "createdAt",
  ];

  const defaultSort = config.defaultSort ?? "createdAt";
  if (!sortKeys.includes(defaultSort)) {
    throw new Error(
      `Resource "${config.name}": defaultSort "${defaultSort}" is not a sortable field.`,
    );
  }

  // ---- payload schemas -----------------------------------------------------

  const storedShape = (mode: "create" | "update") => {
    const shape: Record<string, z.ZodType> = {};
    for (const [name, field] of fieldEntries) {
      if (field.hiddenInForm) continue;
      // An immutable field is accepted on create and refused on update, which
      // is what makes "the SKU can't change" a property of the schema rather
      // than a convention someone has to remember.
      if (mode === "update" && field.immutable) continue;
      shape[name] = field.stored;
    }
    return shape;
  };

  const createSchema = z.object(storedShape("create"));
  const updateSchema = z.object({
    id: z.string().min(1),
    ...storedShape("update"),
  });
  const idSchema = z.object({ id: z.string().min(1) });
  const archiveSchema = z.object({
    id: z.string().min(1),
    archived: z.boolean(),
  });

  // ---- filters -------------------------------------------------------------

  const filters: ResourceFilter[] = [];
  const filterShape: Record<string, z.ZodType> = {};

  if (archivable) {
    filters.push({
      name: "status",
      label: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "archived", label: "Archived" },
      ],
    });
    filterShape.status = z.enum(["active", "archived"]).optional();
  }

  for (const [name, field] of fieldEntries) {
    if (field.kind !== "select" || !field.options) continue;
    filters.push({
      name,
      label: field.label,
      options: [...field.options],
    });
    filterShape[name] = z
      .enum(field.options.map((o) => o.value) as [string, ...string[]])
      .optional();
  }

  const listSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .refine(
        (value) => (PAGE_SIZE_OPTIONS as readonly number[]).includes(value),
        "Unsupported page size.",
      )
      .default(DEFAULT_PAGE_SIZE),
    sort: z.enum(sortKeys as [string, ...string[]]).default(defaultSort),
    order: z.enum(["asc", "desc"]).default(config.defaultOrder ?? "desc"),
    search: z.string().trim().max(200).default(""),
    ...filterShape,
  });

  // ---- derived registration ------------------------------------------------

  const auditActions = [
    `${config.name}.created`,
    `${config.name}.updated`,
    `${config.name}.deleted`,
    ...(archivable
      ? [`${config.name}.archived`, `${config.name}.unarchived`]
      : []),
  ];

  return {
    name: config.name,
    actions,
    label,
    pluralLabel,
    route: config.route,
    segment: config.route.replace(/^\//, ""),
    icon: config.icon,
    nav: config.nav ?? null,
    description:
      config.description ??
      `Manage ${pluralLabel.toLowerCase()}. Actions you can't perform are hidden here and re-checked on the server.`,
    archivable,
    fields: config.fields,
    fieldEntries,
    primaryField,
    secondaryField,
    searchFields,
    searchPlaceholder:
      config.searchPlaceholder ??
      (searchFields.length > 0
        ? `Search by ${searchFields.map((name) => config.fields[name]!.label.toLowerCase()).join(" or ")}…`
        : "Search…"),
    sortKeys,
    defaultSort,
    defaultOrder: config.defaultOrder ?? "desc",
    uniqueFields: fieldEntries
      .filter(([, field]) => field.unique)
      .map(([name]) => name),
    filters,
    emptyTitle: config.emptyTitle ?? `No ${pluralLabel.toLowerCase()} yet`,
    emptyDescription:
      config.emptyDescription ?? `Add the first one to get started.`,
    createSchema,
    updateSchema,
    listSchema,
    idSchema,
    archiveSchema,
    permissionKeys: (actions as readonly string[]).map(
      (action) => `${config.name}:${action}`,
    ),
    auditActions,
    cacheTag: `${config.name}s`,
    recordCacheTag: (id: string) => `${config.name}:${id}`,
  };
}
