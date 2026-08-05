# Modern Admin

A production-grade, domain-agnostic admin panel boilerplate. Fork it, delete
what you don't need, and start building your actual product.

It ships the parts every internal tool needs and nobody enjoys writing twice:
authentication, runtime-editable RBAC, an audit trail that can't be forgotten,
feature flags, and a responsive shell — wired end to end, not stubbed.

**Stack:** Next.js 16 (App Router, Turbopack, React 19) · TypeScript strict ·
Drizzle ORM + PostgreSQL · Better-Auth · Redis · shadcn/ui + Tailwind v4 ·
TanStack Query + Table · Zod · Vitest + Playwright · Storybook

---

## Quick start

```bash
pnpm install
cp .env.example .env          # then set BETTER_AUTH_SECRET
pnpm dev:services             # Postgres + Redis via docker compose
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open <http://localhost:3000> and sign in with the credentials the seed prints:

```text
admin@example.com / ChangeMe123!
```

Generate a real secret with `openssl rand -base64 32`. Everything else in
`.env.example` has a working default.

> Already running Postgres on 5432? Set `POSTGRES_PORT` to something free and
> update `DATABASE_URL` to match.

### Scripts

| Command                              | What it does                                             |
| ------------------------------------ | -------------------------------------------------------- |
| `pnpm dev`                           | Dev server                                               |
| `pnpm build` / `pnpm start`          | Production build / serve                                 |
| `pnpm dev:services`                  | Start Postgres + Redis (`:down`, `:reset` too)           |
| `pnpm db:generate`                   | Generate a migration from schema changes                 |
| `pnpm db:migrate`                    | Apply pending migrations                                 |
| `pnpm db:seed`                       | Seed roles, permissions, admin, sample data (idempotent) |
| `pnpm db:seed:products`              | Bulk-load products — 1M rows by default (idempotent)     |
| `pnpm db:studio`                     | Drizzle Studio                                           |
| `pnpm test` / `pnpm test:coverage`   | Unit + component tests                                   |
| `pnpm test:e2e`                      | Playwright (builds and starts the app itself)            |
| `pnpm storybook`                     | Component workshop on :6006                              |
| `pnpm lint` / `typecheck` / `format` | The CI gates                                             |

---

## Architecture

### The layering rule

```text
Route Handler    ─┐
Server Action    ─┼─→  service  ─→  repository  ─→  Drizzle  ─→  database
Server Component ─┘
```

**Transports never touch Drizzle.** Every read and write goes through a
service. That isn't ceremony — it's what makes these guarantees hold:

- **Authorization can't be skipped.** `requirePermission()` lives in the
  service. A new transport calling an existing service is authorised for free.
- **Auditing can't be forgotten.** `logAudit()` is called from the service
  layer, so a CLI, a webhook and a form all produce the same record.
- **Cache invalidation happens once.** Next to the mutation, not at three call
  sites that will drift.

A Server Action reaching into `db` directly bypasses all three, silently.
That's the one review comment worth always making.

### Layout

```text
src/
├── app/
│   ├── (auth)/           sign-in, sign-up, forgot/reset password, verify, 2FA
│   ├── (dashboard)/      the panel — layout.tsx is the real auth boundary
│   └── api/              REST surface + Better-Auth catch-all + /health
├── components/
│   ├── ui/               shadcn primitives (CLI-generated, don't hand-edit)
│   ├── shared/           DataTable, PageHeader, ConfirmDialog, EmptyState, …
│   └── layout/           Sidebar, Topbar, MobileNav, Breadcrumbs, palette
├── modules/              one folder per domain, self-contained
│   ├── users/            the reference implementation — copy this one
│   ├── rbac/             permissions.service.ts is the authorization boundary
│   ├── audit-log/
│   ├── feature-flags/
│   ├── auth/
│   └── cache/            two cache layers, documented in its own README
├── db/schema/            one file per domain, barrelled
├── lib/                  env, auth, errors, logger, permissions, redis
├── hooks/
├── stories/              mirrors components/
└── proxy.ts              optimistic redirects (Next 16's middleware.ts)
```

A module owns `*.repository.ts`, `*.service.ts`, `*.schema.ts`, `*.actions.ts`
and its `components/`. Deleting a module means deleting one folder, one nav
entry, and one schema file.

### Authorization

Two sources of truth, layered:

1. **`src/lib/permissions.ts`** — the compile-time `statement`: every
   `(resource, action)` pair the app knows how to authorise. Typed, so
   `requirePermission("user", "bnan")` won't compile.
2. **The `roles` / `permissions` / `role_permissions` tables** — the runtime
   projection of it. Operators create roles and tick boxes; no deploy needed.

`pnpm db:seed` reconciles (2) against (1), adding new pairs and dropping
removed ones.

```ts
// Server: throws ForbiddenError → 403 or the <Forbidden /> screen.
await requirePermission("user", "ban");

// Server, non-throwing.
if (await hasPermission("auditLog", "export")) {
  /* … */
}

// Client: hides UI. Never trusted — always paired with the server check.
const canBan = usePermission("user", "ban");
```

Three invariants worth knowing before changing anything here:

- **No privilege escalation.** You cannot create or edit a role to grant a
  permission you don't hold, or assign such a role to anyone
  (`assertNoPrivilegeEscalation`). Without it, `role:create` means `*`.
- **No lateral takeover.** You cannot ban, delete or impersonate a user who
  holds permissions you lack.
- **No self-lockout.** You cannot strip your own last role, or remove your own
  ability to manage roles.

Privileged checks always read a **fresh** session, never the signed cookie
cache — otherwise a user banned 30 seconds ago still carries a cookie that says
they're fine.

### The two caches

They solve different problems and are invalidated by different calls. Full
explanation in [`src/modules/cache/README.md`](src/modules/cache/README.md).

- **Redis** — cross-request shared state: flag evaluation, resolved permission
  sets, rate-limit counters, Better-Auth session storage. Invalidate with
  `cache.invalidateTags(...)`. Fails open: an outage costs latency, not uptime.
- **Next.js data cache** — per-deployment RSC render caching. Invalidate with
  `invalidateQueryTags(...)`.

A write usually invalidates both. Do it in the service.

### Errors

A typed hierarchy in `lib/errors.ts` (`ForbiddenError`, `NotFoundError`,
`ConflictError`, `ValidationError`, …), mapped consistently:

| Thrown in        | Becomes                                                            |
| ---------------- | ------------------------------------------------------------------ |
| Route Handler    | JSON `{ error: { code, message } }` + status, via `withApiHandler` |
| Server Action    | An `ActionResult` discriminated union, via `withAction`            |
| Server Component | `error.tsx` / `not-found.tsx` / `<Forbidden />`                    |

Unexpected errors never leak their message — it may carry a query or a
hostname. Expected ones keep theirs, because they were written to be read.

---

## How to add a new module

Say you're adding **projects**. Roughly 20 minutes, in this order.

### 1. Schema

```ts
// src/db/schema/projects.ts
export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("projects_archived_idx").on(table.archived)],
);
```

Export it from `src/db/schema/index.ts`, then:

```bash
pnpm db:generate && pnpm db:migrate
```

### 2. Permissions

Add the resource to the statement in `src/lib/permissions.ts`:

```ts
export const statement = {
  // …
  project: ["create", "read", "update", "delete", "archive"],
} as const satisfies Record<string, readonly string[]>;
```

Grant it in `SYSTEM_ROLES`, then `pnpm db:seed`. It now appears in the Roles
permission matrix automatically.

### 3. Module

Create `src/modules/projects/` with four files:

- **`projects.schema.ts`** — zod for every input. Avoid `z.coerce` in a schema
  a form uses: it makes the zod input type diverge from the output and fights
  react-hook-form's single generic. Coerce at the REST boundary instead.
- **`projects.repository.ts`** — Drizzle only. No authorization, no auditing.
  This is the only layer allowed dialect-specific SQL (`ilike` and friends).
- **`projects.service.ts`** — the real work, always in this order:

  ```ts
  async function archive(input: unknown) {
    await requirePermission("project", "archive"); // 1. authorise
    const values = archiveProjectSchema.parse(input); // 2. validate

    const before = await projectsRepository.findById(values.id);
    if (!before) throw new NotFoundError("Project", values.id);

    const after = await projectsRepository.update(values.id, {
      archived: true,
    });

    await logAudit({
      // 3. audit
      action: "project.archived",
      resourceType: "project",
      resourceId: values.id,
      before: { archived: before.archived },
      after: { archived: true },
    });

    invalidateQueryTags(cacheTags.projects); // 4. invalidate
    return after;
  }
  ```

- **`projects.actions.ts`** — `"use server"` wrappers. Thin:

  ```ts
  export async function archiveProjectAction(input: unknown) {
    return withAction("projects.archive", async () => {
      const project = await projectsService.archive(input);
      revalidatePath("/projects");
      return { id: project.id };
    });
  }
  ```

Add the new actions to `AUDIT_ACTIONS` and `AUDIT_RESOURCE_TYPES` in
`src/modules/audit-log/audit-log.schema.ts`. It's a closed set so the filter
dropdown stays honest and `"project.archvied"` can't become a silent second
category.

### 4. UI

```tsx
// src/app/(dashboard)/projects/page.tsx
export default async function ProjectsPage({ searchParams }) {
  if (!(await hasPermission("project", "read"))) return <Forbidden />;

  const params = parseTableParams(await searchParams);
  const { rows, total } = await projectsService.list(params);

  return <ProjectsView projects={rows} totalRows={total} params={params} />;
}
```

The client view renders `<DataTable>` and owns dialog state. Copy
`src/modules/users/components/` — it's the reference implementation.

### 5. Navigation

One entry in `src/components/layout/nav-config.ts`. The sidebar, mobile drawer,
command palette and breadcrumbs all read from it.

```ts
{
  title: "Projects",
  href: "/projects",
  icon: FolderKanban,
  description: "Create, archive and assign projects",
  permission: "project:read",
  matchNested: true,
}
```

### 6. Tests and stories

- Service tests with a mocked repository — the business rules are the point.
- A Playwright spec if it has a write path worth protecting.
- Stories for anything reusable you added to `components/shared/`.

---

## Operations

### Health

`GET /api/health` — unauthenticated, `200` when Postgres and Redis are both
reachable, `503` otherwise. Exposes only booleans and latencies.

### Audit log retention

`AUDIT_LOG_RETENTION_DAYS` (default 90) governs
`auditLogService.purgeExpired()`. It is **not** scheduled by the app — Next.js
has no scheduler, and a `setInterval` in a serverless process is a bug. Wire it
to whatever you already run:

```ts
// A cron route, called by Vercel Cron / GitHub Actions / a k8s CronJob.
export const GET = withApiHandler("auditLog", "export", async () => {
  const result = await auditLogService.purgeExpired();
  return NextResponse.json(result);
});
```

`purgeExpired({ dryRun: true })` reports what it would delete.

### Deployment checklist

- [ ] `BETTER_AUTH_SECRET` is a fresh 32-byte random value, not the example.
- [ ] `NEXT_PUBLIC_APP_URL` is your real **https** origin. Cookie `Secure` is
      derived from its protocol, so getting this wrong breaks sessions.
- [ ] `REDIS_URL` is set. The app refuses to boot in production without it —
      the in-memory fallback is per-process and would desync across instances.
- [ ] `MAIL_TRANSPORT=resend` (plus `RESEND_API_KEY`), or your own transport in
      `lib/mail.ts`. The `console` default only prints to the server log.
- [ ] `pnpm db:migrate` runs on deploy. Never `db:push` against real data.
- [ ] The seeded admin's password is changed, or the account is replaced.
- [ ] `AUTH_RATE_LIMIT_MAX` suits your topology — the default assumes roughly
      one user per IP.

---

## Testing

```bash
pnpm test               # 159 unit + component tests
pnpm test:coverage      # with the coverage ratchet
pnpm test:e2e           # 40 Playwright tests, real Postgres + Redis
```

Unit tests cover services, guards and pure logic. Repositories are excluded
from coverage on purpose: a percentage over SQL that never touched a database
is a number, not a signal. Playwright covers them for real.

The e2e suite asserts each Definition-of-Done clause directly — unauthenticated
routes redirect, a viewer is refused every write, mutations produce audit rows,
a flag toggle changes behaviour in the same running process, and every screen
fits 375px without horizontal scroll.

CI (`.github/workflows/ci.yml`) runs typecheck/lint/format, unit tests, the
production and Storybook builds, then e2e against service containers.

---

## Assumptions

Places where the build brief and reality disagreed, and what was chosen:

- **`proxy.ts`, not `middleware.ts`.** Next 16 renamed the convention and
  deprecates the old name. Same semantics. It does optimistic cookie checks
  only — the dashboard layout re-reads the real session, so a forged cookie
  earns a redirect, not access.
- **Storybook 10, not 8.** Storybook 8's Next adapter peers on
  `next: ^14 || ^15`; it cannot load this app.
- **shadcn `radix-nova` preset, not `new-york`.** The shadcn CLI replaced named
  styles with presets. `radix-nova` is the current equivalent: neutral base,
  Radix primitives, Lucide icons.
- **`unstable_cache` + `revalidateTag(tag, "max")`.** Next 16 supersedes these
  with `use cache` under Cache Components, an opt-in that changes rendering
  app-wide. `src/modules/cache/next-cache.ts` is the only file to change when
  you adopt it.
- **shadcn no longer ships a `form` component**, so
  `components/shared/form-field.tsx` bridges react-hook-form to the newer
  `field` primitives.
- **Cache docs live at `src/modules/cache/README.md`**, next to the code,
  rather than at `lib/cache/README.md`.
- **The console mail transport is a real transport, not a stub.** It prints
  verification and reset links to the server log, which is what makes a fresh
  clone usable with no mail provider. `resend` ships alongside it.
- **`TextField` has no `autoFocus` prop.** Programmatic focus on mount moves a
  screen reader's viewport unasked; inside dialogs Radix already does the right
  thing.
- **Auth rate limits are env-configurable** with the secure values as defaults,
  because the correct ceiling depends on whether your users share an egress IP.

## License

MIT. Take it and go.
