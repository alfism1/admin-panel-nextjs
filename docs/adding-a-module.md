# Adding a new module

A module is a **resource**: one declaration, one Drizzle table, two lines of
registration. Everything a CRUD screen needs — permissions, navigation, audit
vocabulary, cache tags, validation, data access, Server Actions, the page, the
table and the form — is derived from that declaration.

This document is the reference. The short version is in the
[README](../README.md#how-to-add-a-new-module).

> **History.** Modules used to be eight hand-written files plus eight edits
> across five shared registries, and this document was a 2,100-line walkthrough
> of that process. `src/lib/resource/` replaced it. The architecture it
> describes — repository → service → transport, with authorise/validate/audit/
> invalidate in that order — is unchanged; it is now written once in the
> framework instead of once per module.

---

## The model

```text
product.resource.ts ──┬─→ permission statement      (lib/permissions.ts)
   (isomorphic)       ├─→ navigation                (components/layout/nav-config.ts)
                      ├─→ audit vocabulary          (modules/audit-log/audit-log.schema.ts)
                      ├─→ cache tags                (descriptor.cacheTag)
                      ├─→ zod schemas               (create / update / list / id / archive)
                      ├─→ table + form              (ResourceIndex, ResourceFormDialog)
                      └─→ /products                 (app/(dashboard)/[resource])

product.server.ts  ───┬─→ repository                (generic, incl. the search plan)
   (server only)      └─→ service                   (authorise → validate → rules → audit → invalidate)
```

Two files per module, and the split is a **bundling boundary**, not a style
choice. `*.resource.ts` is imported by the sidebar and the form dialog, so it
runs in the browser; importing a Drizzle table from it would pull
`drizzle-orm/pg-core` into the client bundle. `*.server.ts` holds that binding.

---

## Naming convention

| Thing        | Form                                   | Example                  |
| ------------ | -------------------------------------- | ------------------------ |
| `name`       | singular, camelCase                    | `product`, `featureFlag` |
| `route`      | plural, kebab-case, leading slash      | `/products`              |
| Table        | plural, snake_case                     | `products`               |
| Field keys   | **must match the Drizzle column keys** | `priceCents`             |
| Permission   | `<name>:<action>`                      | `product:archive`        |
| Audit action | `<name>.<past tense>`                  | `product.archived`       |

The field-key rule is the one that bites. The generic repository resolves every
column through `getTableColumns(table)[fieldName]` and throws at startup if a
field has no column, so a mismatch fails loudly rather than silently.

---

## Step 1 — The table

Ordinary Drizzle. Four columns are special to the framework:

| Column                  | Required             | Used for                                           |
| ----------------------- | -------------------- | -------------------------------------------------- |
| `id` (text, PK)         | yes                  | lookups, tie-breaking the sort, audit `resourceId` |
| `createdAt` (timestamp) | yes                  | the "Added" column and the default sort            |
| `updatedAt` (timestamp) | no                   | stamped automatically on every update              |
| `archived` (boolean)    | only if `archivable` | status column, filter, archive action              |

Ids are generated in application code (`newId()`), not by the database — see
[`src/db/id.ts`](../src/db/id.ts) for why.

If the resource has searchable text fields, add trigram indexes for them:

```ts
index("projects_name_trgm_idx").using("gin", table.name.op("gin_trgm_ops")),
```

Without them the search still works and still returns correct results, but the
plan-switching described below has nothing fast to switch _to_. See
[search-performance.md](search-performance.md).

---

## Step 2 — The descriptor

```ts
// src/modules/projects/project.resource.ts
import { FolderKanban } from "lucide-react";

import { defineResource } from "@/lib/resource/define";
import { field } from "@/lib/resource/fields";

export const projectResource = defineResource({
  name: "project",
  route: "/projects",
  icon: FolderKanban,
  nav: {
    group: "Operations",
    description: "Create, archive and assign projects",
  },
  archivable: true,
  primaryField: "name",
  secondaryField: "code",
  fields: {
    code: field.text({
      label: "Code",
      immutable: true,
      unique: true,
      searchable: true,
    }),
    name: field.text({ label: "Name", max: 160, searchable: true }),
    budgetCents: field.money({ label: "Budget", currency: "USD" }),
    notes: field.textarea({ label: "Notes", optional: true, inTable: false }),
  },
});
```

### Resource options

| Option                            | Default                          | Effect                                                                  |
| --------------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| `name`                            | —                                | permission resource, audit prefix, registry key                         |
| `route`                           | —                                | URL, and the segment the catch-all route matches                        |
| `icon`                            | —                                | sidebar, command palette, empty state                                   |
| `nav`                             | `null`                           | `null` registers the resource but hides it from navigation              |
| `label` / `pluralLabel`           | title-cased `name`               | headings, buttons, toasts                                               |
| `description`                     | generated                        | page-header blurb                                                       |
| `archivable`                      | `false`                          | adds `archive` permission, status column + filter, row action           |
| `extraActions`                    | `[]`                             | extra permission actions (`export`, `publish`) — you wire the behaviour |
| `primaryField`                    | first field                      | the row headline; also the sort on that column                          |
| `secondaryField`                  | —                                | shown under the headline, and typed to confirm a delete                 |
| `defaultSort` / `defaultOrder`    | `createdAt` / `desc`             | must name a sortable field                                              |
| `searchPlaceholder`               | generated from searchable fields | toolbar                                                                 |
| `emptyTitle` / `emptyDescription` | generated                        | empty state                                                             |

### Field builders

All in [`src/lib/resource/fields.ts`](../src/lib/resource/fields.ts).

| Builder          | Stored as         | Edited as  | Notes                                                   |
| ---------------- | ----------------- | ---------- | ------------------------------------------------------- |
| `field.text`     | `string`          | text input | `sortable` and `searchable` default on/off respectively |
| `field.textarea` | `string`          | textarea   | never sortable, excluded from mobile inline row         |
| `field.number`   | `int`             | text input | validated as a whole number                             |
| `field.money`    | `int` minor units | `"19.99"`  | rounds on submit, formats with `Intl`                   |
| `field.boolean`  | `boolean`         | switch     |                                                         |
| `field.select`   | `enum`            | select     | also becomes a toolbar filter automatically             |

Shared options: `label`, `description`, `placeholder`, `optional`, `immutable`,
`hiddenInForm`, `inTable`, `sortable`, `unique`.

Three of those carry real behaviour:

- **`immutable`** — accepted on create, **stripped from `updateSchema`**. Not a
  convention: the field is removed from the parsed payload, so no layer below
  can see an attempted change. Rendered read-only in the edit dialog.
- **`unique`** — the service checks before writing and raises a readable
  `ConflictError`. The database index is still the guarantee under a race;
  this is only the friendly path.
- **`searchable`** — joins the `ilike` predicate. Text fields only, and be
  sparing: on products, including `description` matched ~1M of 7M rows and cost
  ~500MB of trigram index for matches nobody wanted.

### Two representations

A field owns both. The service validates the **stored** shape
(`budgetCents: 1999`); the form validates the **edited** shape (`"19.99"`) and
converts on submit. That is why `z.coerce` is avoided in form-facing schemas —
it makes the zod input and output types diverge, which react-hook-form's single
generic cannot express.

Because form field names _are_ stored field names, a server-side field error
lands on the right input with no translation table. The hand-written
`FIELD_MAP` every dialog used to carry is gone.

---

## Step 3 — The backend

```ts
// src/modules/projects/project.server.ts
import "server-only";

import { projects } from "@/db/schema";
import { createResourceBackend } from "@/lib/resource/backend";

import { projectResource } from "./project.resource";

export const projectBackend = createResourceBackend(projectResource, {
  table: projects,
});
```

### Rules — the escape hatch

```ts
export const projectBackend = createResourceBackend(projectResource, {
  table: projects,
  rules: {
    beforeCreate: async (values) => {
      if (await isOverBudget(values.budgetCents)) {
        throw new ValidationError("Budget exceeds the annual cap.", {
          budgetCents: ["Above the cap for this year."],
        });
      }
    },
    beforeDelete: async (before) => {
      if (before.archived === false) {
        throw new ConflictError("Archive the project before deleting it.");
      }
    },
    // Audit entries are read by people months later. Default is every declared
    // field; narrow it when a column is noisy or sensitive.
    snapshot: (row) => ({ code: row.code, name: row.name }),
  },
});
```

`beforeCreate` and `beforeUpdate` run **after** authorisation, validation and
the uniqueness checks — so they can assume a well-formed payload from a caller
who is allowed to make the call.

Throw `ValidationError` with `fieldErrors` to put a message on a specific input;
throw `ConflictError` / `NotFoundError` / `ForbiddenError` for a banner.

---

## Step 4 — Register

```ts
// src/lib/resource/registry.ts
export const resources = [productResource, projectResource] as const;
```

```ts
// src/lib/resource/registry.server.ts
const backends: ResourceBackend[] = [productBackend, projectBackend];
```

`as const` on the first is load-bearing. `PermissionKey` is a template-literal
union built from these names and actions; losing the literal types degrades
every permission check in the app to `string`.

Then `pnpm db:seed` to project the new permissions into the `permissions` table
and the Roles matrix.

---

## What gets derived

### Permissions

`create`, `read`, `update`, `delete`, plus `archive` when `archivable`, plus
`extraActions`. Seeded roles get them automatically:

| Role          | Grant        |
| ------------- | ------------ |
| `super_admin` | every action |
| `admin`       | every action |
| `viewer`      | `read`       |

**This is a policy decision worth knowing about**: a resource is live for admins
the moment it is registered and seeded. A resource needing a narrower default
should be listed explicitly in `SYSTEM_ROLES` in
[`src/lib/permissions.ts`](../src/lib/permissions.ts), which still wins.

### The route

`src/app/(dashboard)/[resource]/page.tsx` serves every registered resource.
Static segments beat dynamic ones in Next's matcher, so `/users`, `/roles`,
`/audit-logs`, `/feature-flags` and `/settings` still resolve to their own
files. Unregistered paths 404.

### Data access

`createResourceRepository` builds the paged read, and it is the reason this is a
factory rather than a template. Search picks between two query plans based on a
capped count, because no single plan is fast for every term:

| matches | index-ordered plan | materialised-CTE plan |
| ------- | ------------------ | --------------------- |
| 0       | 40,000ms           | 0.7ms                 |
| 1,000   | 1,000ms            | 167ms                 |
| 580,000 | 4ms                | 9,000ms               |

Every new resource inherits that. Hand-writing the repository per module meant
every new module got a fresh chance to reintroduce the 40-second query.

---

## When to eject

The descriptor covers a CRUD index. When it doesn't fit:

| Need                                   | Do this                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A bespoke screen                       | Add a real `app/(dashboard)/<segment>/page.tsx`. Static beats dynamic, so it takes over with no other change. |
| A detail/edit route                    | Add `app/(dashboard)/<segment>/[id]/page.tsx` and use `backend.service.findById`.                             |
| A new field type                       | Add a builder to `fields.ts` — every resource gets it.                                                        |
| A read the generic table can't express | `backend.repository` is a normal object; call it, or write a module-specific repository beside it.            |
| Custom transport                       | `backend.service` is what a Route Handler should call, exactly as before.                                     |

Ejecting one part does not mean ejecting the module. A custom page can still use
the registry's permissions, audit actions and cache tags.

---

## Testing

The descriptor is data, so most assertions are direct — no mounting, no mocks:

```ts
expect(projectResource.uniqueFields).toEqual(["code"]);
expect(
  projectResource.updateSchema.parse({ id: "1", code: "X", name: "N" }).code,
).toBeUndefined(); // immutable fields are stripped, not ignored
```

See [`src/lib/resource/resource.test.ts`](../src/lib/resource/resource.test.ts).

For anything in `rules`, test the service with a mocked repository — that is
where the business logic lives and it is worth the coverage. The generic
repository is exercised by the Playwright suite against real Postgres.

---

## Checklist

- [ ] Table created, exported from `db/schema/index.ts`, migration generated and run
- [ ] Trigram indexes for searchable text columns
- [ ] Field keys match the Drizzle column keys
- [ ] `*.resource.ts` imports no Drizzle table
- [ ] Added to `registry.ts` (inside `as const`) and `registry.server.ts`
- [ ] `pnpm db:seed`
- [ ] `pnpm typecheck && pnpm lint && pnpm test`
- [ ] Role grants reviewed if the defaults are too generous
