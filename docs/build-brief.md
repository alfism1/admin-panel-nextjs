> **How to use this:** Paste everything below into Claude Code / Codex in a fresh, empty repo. It's written as a standalone build brief for the agent — treat each numbered item in Section 8 as a milestone, commit after each one, and run `pnpm lint && pnpm typecheck && pnpm build` before moving on. If a decision isn't covered here, make a reasonable default, note it in the README under "Assumptions," and keep going — don't stop to ask.

---

# Build: Universal Admin Panel Boilerplate

## 0. Role & Ground Rules

You are building a **production-grade, domain-agnostic Admin Panel Boilerplate**. This is a brand-new repository — do not reference or assume any prior project, existing conventions, or business domain. Everything must be generic and reusable as a starting point for any future SaaS admin, internal tool, or CMS backend.

Non-negotiables:
- TypeScript strict mode everywhere. No `any` unless justified with an inline comment.
- No placeholder/TODO business logic — every module listed below must be functional end-to-end.
- Default-deny: every piece of server logic is reachable only through an authenticated + authorized path.
- Mobile responsive is a first-class requirement. Verify every screen at 375px, 768px, and 1280px.
- Write it the way you'd write a repo that gets forked dozens of times by other engineers.

## 1. Tech Stack (locked in)

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router, Turbopack, React 19) | Full-stack only — Route Handlers + Server Actions, no separate backend service |
| Language | TypeScript, strict mode | |
| ORM | Drizzle ORM + drizzle-kit | Portable across Postgres/MySQL/SQLite, edge-native, ~7kb, keeps schema in TS |
| Database | PostgreSQL by default (swappable) | via docker-compose for local dev |
| Auth | Better-Auth, with `admin` + `twoFactor` plugins | Self-hosted, no per-MAU cost, Drizzle adapter, plugin-based RBAC/2FA/impersonation |
| UI | shadcn/ui (`new-york` style) + Tailwind v4 + Radix | |
| Client data/cache | TanStack Query | |
| Server cache | Redis (ioredis) + Next.js `unstable_cache` / `revalidateTag` | Two distinct layers — don't conflate them |
| Validation | Zod | Every Server Action / Route Handler boundary |
| Env validation | `@t3-oss/env-nextjs` | Fail fast on missing config |
| Component workshop | Storybook 8 (Next.js framework adapter) | |
| Testing | Vitest + Testing Library (unit/component), Playwright (e2e) | |
| Tooling | ESLint (strict + jsx-a11y), Prettier, Husky + lint-staged, Commitlint | |
| Package manager | pnpm | |

## 2. Architecture

- Full-stack Next.js only. Route Handlers (`app/api/**`) for anything needing REST semantics or webhooks; Server Actions for dashboard form mutations.
- Layered per feature: `route/action → service → repository (Drizzle) → db`. Server Actions and Route Handlers never touch Drizzle directly — always go through a service function so logic stays testable and reusable.
- Domain-first `src/` layout (not type-first), so each module is self-contained and easy to extract or delete later.

## 3. Folder Structure

```
.
├── drizzle/                        # generated migrations
├── public/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── sign-in/page.tsx
│   │   │   ├── sign-up/page.tsx
│   │   │   ├── forgot-password/page.tsx
│   │   │   └── reset-password/page.tsx
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx          # sidebar + topbar shell, responsive
│   │   │   ├── page.tsx            # overview
│   │   │   ├── users/
│   │   │   ├── roles/
│   │   │   ├── audit-logs/
│   │   │   ├── feature-flags/
│   │   │   └── settings/
│   │   ├── api/
│   │   │   ├── auth/[...all]/route.ts   # better-auth handler
│   │   │   ├── users/route.ts
│   │   │   ├── roles/route.ts
│   │   │   ├── audit-logs/route.ts
│   │   │   ├── feature-flags/route.ts
│   │   │   └── health/route.ts
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                     # shadcn primitives (CLI-generated, don't hand-edit)
│   │   ├── shared/                 # DataTable, PageHeader, ConfirmDialog, EmptyState, StatCard...
│   │   └── layout/                 # Sidebar, Topbar, MobileNav, Breadcrumbs
│   ├── modules/                    # feature/domain modules
│   │   ├── users/
│   │   │   ├── users.repository.ts
│   │   │   ├── users.service.ts
│   │   │   ├── users.schema.ts     # zod
│   │   │   └── users.actions.ts
│   │   ├── rbac/
│   │   ├── audit-log/
│   │   ├── feature-flags/
│   │   └── cache/
│   ├── db/
│   │   ├── schema/                 # one file per domain
│   │   ├── client.ts
│   │   └── index.ts
│   ├── lib/
│   │   ├── auth.ts                 # better-auth server config
│   │   ├── auth-client.ts
│   │   ├── redis.ts
│   │   ├── env.ts                  # t3-env
│   │   ├── permissions.ts          # access-control statements
│   │   └── utils.ts
│   ├── hooks/
│   ├── stories/                    # storybook stories, mirrors components/
│   └── middleware.ts
├── .storybook/
├── docker-compose.yml
├── drizzle.config.ts
├── .env.example
└── (config files: eslint, prettier, husky, commitlint, playwright, vitest)
```

## 4. Module Specs

### 4.1 Authentication — Better-Auth
- Configure `lib/auth.ts` with the Drizzle adapter.
- Providers: email/password (email verification required before first login) + Google & GitHub OAuth, env-gated — only registered if their client id/secret env vars are present.
- Sessions: database-backed, 30-day expiry, sliding refresh. Cookie cache can be enabled for perf, but privileged actions (role change, ban) must force a fresh session read rather than trusting the cache.
- Add the `admin` plugin (ban/impersonate/session-revoke/reset-password) and the `twoFactor` plugin (TOTP, opt-in per user, with a per-role "force 2FA" setting, e.g. required for `admin`).
- Mount everything at `app/api/auth/[...all]/route.ts`.
- Auth pages (sign-in, sign-up, forgot/reset password, verify-email-pending) are shadcn-styled, mobile-first, validated client-side with `react-hook-form` + zod.
- `middleware.ts` redirects unauthenticated users off `(dashboard)/*` to `/sign-in?redirect=`, and redirects authenticated users away from `(auth)/*`.

### 4.2 Authorization / RBAC
- Build on Better-Auth's `admin` plugin access-control system: `createAccessControl` with a `statement` object mapping resources to actions — e.g. `user: [create, read, update, delete, ban]`, `role: [create, read, update, delete, assign]`, `auditLog: [read, export]`, `featureFlag: [create, read, update, delete, toggle]`.
- Ship three seeded roles — `super_admin` (everything), `admin` (manage users/content, can't edit roles/permissions), `viewer` (read-only) — but the point of the module is that new roles can be created from the UI without touching code.
- Custom roles/permissions live in DB (`roles`, `permissions`, `role_permissions` tables), layered on top of Better-Auth's role field so access-control statements can be extended at runtime.
- Server guard: `requirePermission(resource, action)`, usable in Server Actions, Route Handlers, and Server Components — throws a typed `ForbiddenError`, mapped to a 403 or a `<Forbidden />` boundary.
- Client hook: `usePermission(resource, action)` to hide (not just disable) actions a user can't perform — always paired with the server check, never trusted alone.
- Roles UI: permission matrix (resources × actions as checkboxes), role assignment from the Users page.

### 4.3 Audit Logs
- `audit_logs` table: `id, actor_id, actor_email, action, resource_type, resource_id, before (jsonb), after (jsonb), ip, user_agent, created_at`.
- One `logAudit()` service function, called from every mutating service method — wired in at the service layer so nothing gets missed.
- Auto-captured events: sign-in/out, failed login attempts, role/permission changes, impersonation start/stop (via Better-Auth hooks).
- Admin UI: paginated, filterable (actor, action, resource type, date range), a before/after diff view, CSV export gated behind `auditLog:export`.
- Retention: `AUDIT_LOG_RETENTION_DAYS` env var, with a cleanup function stubbed for a cron/queue trigger.

### 4.4 Feature Flags
- `feature_flags` table: `id, key, name, description, enabled, rules (jsonb — % rollout / user / role targeting), created_at, updated_at`.
- Cache-aside read path: Redis first (`flag:{key}`, short TTL), fall back to DB, populate cache, invalidate on write.
- `isFeatureEnabled(key, context?)` server helper; `useFeatureFlag(key)` client hook backed by a small `/api/feature-flags/evaluate` route so flags can change without a redeploy.
- Admin UI: searchable toggle table, inline rollout-rule editor, "who is this on for" preview.
- Every flag change goes through the audit log.

### 4.5 Caching Layer
- Redis (`ioredis`) as a singleton in `lib/redis.ts` — used for Better-Auth secondary session storage, feature-flag cache, and a generic `cache.get/set/wrap` utility with tag-based invalidation.
- Pair with Next.js's own data cache: `unstable_cache` + `revalidateTag` for RSC reads (users list, roles list) so invalidation is precise instead of blanket `revalidatePath`.
- Document the split clearly in `lib/cache/README.md`: Redis = cross-request/shared state, Next data cache = RSC render caching.

### 4.6 Data Layer / ORM (Drizzle)
- Postgres as the default local/dev dialect (via docker-compose), but keep schema code portable — avoid Postgres-only types where a cross-dialect equivalent exists, and isolate any dialect-specific SQL inside the repository layer.
- One schema file per domain under `db/schema/*.ts`, barrel-exported from `db/schema/index.ts`.
- `drizzle-kit` for migrations (`generate`, `migrate`) — never hand-edit generated SQL.
- `db/seed.ts` creates default roles/permissions, one `super_admin` user, a handful of feature flags, and sample audit log entries, runnable via `pnpm db:seed`.

### 4.7 Component System & Storybook
- All primitives come from `shadcn/ui` (Tailwind v4, `new-york` style, React 19), added via the CLI — never hand-rolled duplicates.
- A `components/shared/` layer on top for admin-panel patterns used everywhere: `DataTable` (sortable, filterable, paginated, row + bulk actions, collapses to cards below `md`), `PageHeader`, `ConfirmDialog`, `EmptyState`, `StatCard`, `FormField` wrappers.
- Every component in `components/shared/` and `components/layout/` gets a co-located Storybook story under `src/stories/`: default, loading/skeleton, empty state, and a mobile-viewport story at minimum.
- Storybook 8, Next.js framework adapter, `addon-a11y` enabled and treated as a real gate — no story ships with unresolved a11y violations.

### 4.8 Admin Dashboard Shell
- Sidebar: fixed on desktop (≥1024px), collapsible icon-rail on tablet, off-canvas drawer with overlay on mobile (<768px).
- Topbar: breadcrumbs, command-palette global search (`cmdk`), theme toggle (light/dark/system via `next-themes`), user menu (profile, sign out, impersonation banner when active).
- Consistent `PageHeader` + content pattern across dashboard pages, with skeleton loading states, empty states, and toast feedback (`sonner`) on every mutation.

## 5. Non-Functional Requirements
- **Accessibility**: keyboard-navigable throughout, visible focus states, correct aria labeling — mostly inherited from Radix, but verify custom compositions.
- **Performance**: Server Components by default, Client Components only where interactivity requires it; images via `next/image`; avoid barrel-import bloat from `components/ui`.
- **Security**: rely on Better-Auth's built-in CSRF handling; rate-limit auth routes (Better-Auth's limiter + Redis); zod validation on every Server Action/Route Handler boundary; secrets only via env; nothing service-role-scoped ever ships to the client.
- **Error handling**: a typed `AppError` hierarchy (`ForbiddenError`, `NotFoundError`, `ValidationError`) mapped consistently to HTTP responses and to `error.tsx`/`not-found.tsx` boundaries.
- **Observability**: structured logging (`pino` is fine), request-id propagation, `/api/health` checking DB + Redis connectivity.

## 6. Environment & Tooling
- `.env.example` documenting every variable: DB URL, Redis URL, Better-Auth secret + OAuth client ids/secrets, audit retention days, app URL.
- `@t3-oss/env-nextjs` validates env at boot — never run silently with missing config.
- ESLint (strict + `eslint-plugin-jsx-a11y`), Prettier, Husky pre-commit with `lint-staged`, Commitlint (Conventional Commits).
- `docker-compose.yml` for local Postgres + Redis, with a `pnpm dev:services` script.
- GitHub Actions CI: install → typecheck → lint → unit tests → build, on every PR.

## 7. Testing
- Vitest + Testing Library for services (RBAC permission logic, audit logging, feature-flag evaluation) and components.
- Playwright e2e covering: sign-up → verify email → sign-in; an RBAC-denied action returning 403; an audit log entry appearing after a mutation; a feature flag toggle taking effect live.
- Aim for meaningful coverage on `modules/*` (services/repositories) — not 100% for its own sake.

## 8. Build Order (work in this sequence, commit at each milestone)
1. Repo scaffold: Next.js 16 + TS strict, Tailwind v4, `shadcn init`, ESLint/Prettier/Husky, docker-compose, env validation.
2. Drizzle schema (users/sessions/roles/permissions/audit_logs/feature_flags) + migrations + seed.
3. Better-Auth wired end-to-end (email/password + OAuth + `admin` plugin), auth pages, middleware guards.
4. RBAC: access-control statements, `requirePermission`/`usePermission`, Roles UI.
5. Audit log service, wired into all existing mutations, Audit Logs UI.
6. Feature flags: schema, cache-aside service, evaluate route, Admin UI.
7. Dashboard shell: responsive sidebar/topbar/theme, `DataTable` and shared components, Storybook stories for all of them.
8. Users module UI (list/create/edit/ban/assign-role) as the reference implementation other modules should copy.
9. Tests (unit + e2e) + CI pipeline.
10. README: setup instructions, architecture overview, and a "how to add a new module" guide — this is what makes it genuinely reusable.

## 9. Definition of Done
- [ ] Fresh clone → `pnpm i && pnpm dev:services && pnpm db:migrate && pnpm db:seed && pnpm dev` gives a working app with a working super-admin login.
- [ ] Every dashboard route is unreachable without auth; every write action is unreachable without the right permission (verified by e2e).
- [ ] Every mutation produces an audit log entry.
- [ ] Toggling a feature flag changes behavior without a redeploy.
- [ ] Every screen is usable at 375px width — no horizontal scroll, sidebar collapses correctly.
- [ ] `pnpm storybook` runs and every shared component has a story.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass clean.
