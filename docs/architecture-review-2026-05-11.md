# Social AI — Architecture Review

**Date:** 2026-05-11
**Branch reviewed:** `feat/postgres-migration`
**Scope:** Full codebase at `c:\Users\stefa\projects\social-ai`
**Reviewer:** architect agent (read-only analysis, no code changes)

---

## 1. Executive Summary

Social AI is in a fundamentally healthy state for a learning developer's greenfield project: clear conventions, a working magic-link auth flow, a real authorization layer with multi-tenant `client_id` enforcement, and small, well-named modules. However, **the project is mid-air on the SQLite→Postgres migration and currently won't build or type-check**. Schema (`src/db/schema.ts`) and `drizzle.config.ts` have been rewritten to Postgres while the runtime (`src/db/index.ts`), test scaffolding, repository layer, and call sites still use synchronous `better-sqlite3` APIs.

The biggest risks are:
- (a) finishing this migration cleanly without losing the existing tenant-isolation guarantees,
- (b) old SQLite migration files still on disk that will silently mis-apply if anyone runs `db:migrate`,
- (c) the in-memory rate limiter, which becomes useless once you deploy to Vercel's multi-instance environment that this migration is intended to enable.

The biggest wins are the `authorization.ts` module, the post repository's careful WHERE-clause guards on state transitions, and the post-aware unique index `(clientId, scheduledDate, platform)`.

---

## 2. Current Architecture Map

### Folder Layout

The project lives entirely under `src/` (not the `app/`, `lib/`, `components/` at root described in CLAUDE.md §7 — this is the only meaningful divergence from documented conventions and is fine for a Next.js `src/` setup):

```
src/
├── app/                          Next.js App Router (pages + API routes)
│   ├── page.tsx                  Root redirect logic (login → welcome → dashboard)
│   ├── layout.tsx                Root layout, font loading
│   ├── providers.tsx             Client-side providers wrapper
│   ├── login/page.tsx            Magic-link email form
│   ├── welcome/page.tsx          First-login greeting
│   ├── dashboard/                Client-facing post-review UI
│   │   ├── layout.tsx            Client header + auth gate
│   │   └── page.tsx              Pending/upcoming/published lists
│   ├── admin/                    Stefan's agency dashboard
│   │   ├── page.tsx              User list + delete buttons
│   │   ├── clients/              CRUD for client businesses
│   │   └── generate-preview/     Server-gated + client UI split for AI generation preview
│   └── api/
│       ├── auth/[...nextauth]/   Auth.js route handler
│       ├── admin/delete-user/    Admin-only user deletion + audit log
│       ├── posts/                GET posts by date range
│       ├── generate-posts/       Two-stage Claude generation (plan + write)
│       ├── photos/upload/        Vercel Blob upload + analysis
│       ├── photos/[id]/analyze/  Re-run analysis
│       └── cron/check-alerts/    Vercel Cron: stale + regen-limit alerts
├── components/
│   ├── dashboard/                PostCard, PostSlideOver, PendingPosts, etc.
│   ├── sign-out-button.tsx
│   └── success-banner.tsx
├── db/
│   ├── index.ts                  DB connection (currently SQLite!)
│   ├── schema.ts                 Drizzle schema (already Postgres)
│   └── migrations/               6 stale SQLite migrations
├── lib/
│   ├── auth.ts                   NextAuth config + Resend magic-link
│   ├── authorization.ts          requireUser/requireAdmin/requireClientAccess
│   ├── rate-limit.ts             In-memory per-email/key limiter
│   ├── request-rate-limit.ts     IP-based wrapper for API routes
│   ├── welcome-email.ts          Onboarding email
│   ├── ai/                       Claude client, prompts, validation, photo analysis
│   ├── photos/                   Upload + analyze helpers
│   ├── posts/
│   │   ├── repository.ts         All DB reads/writes for posts (the data layer)
│   │   ├── actions.ts            Server actions (approve/reject/regenerate)
│   │   ├── dates.ts              Tuesday-Monday week math
│   │   ├── config.ts             Constants: MAX_REJECTIONS, INDUSTRY_POST_TIMES
│   │   ├── locked-days.ts        Approval-locking helpers
│   │   └── types.ts              Post, PostsByDay, LockedDay
│   ├── alerts/                   Stale-post + regen-limit detection + email
│   └── time/business-hours.ts    NL-aware cron gate
├── proxy.ts                      Next 16's renamed middleware (session-cookie gate)
├── data/clients/cafe-de-hoek.ts  Hardcoded reference data (legacy from prototype phase)
└── test/db.ts                    Test DB factory (currently SQLite-in-memory)

scripts/                          Tsx-runnable seed + E2E scripts
docs/                             Spec, handoffs, superpowers plans
```

### Data Flow (Happy Path)

1. **Login:** browser → `/login` → `signIn("resend")` → `lib/auth.ts` checks `users` row exists → emails magic link via Resend → user clicks → Auth.js sets session cookie via DrizzleAdapter writing to `sessions` table → `proxy.ts` lets the cookie pass → `app/page.tsx` redirects based on `users.hasLoggedIn` and `users.role`.
2. **Generation:** admin opens `/admin/generate-preview` → POSTs to `/api/generate-posts` → `requireClientAccess()` confirms the user owns or is admin over `clientId` → `getLockedDays` reads what can't be regenerated → two Claude calls (plan, then write with photos as URL-source images) → `replacePostsForOpenDays` atomically deletes drafts/rejected and inserts new rows in a transaction.
3. **Review:** client opens `/dashboard` → `getPostsByDateRange` for the current Tuesday-Monday week → `markPostsAsSeen` stamps `firstSeenAt` on new drafts → server action `approvePostAction` runs `approvePost(db, postId, clientId)` which UPDATEs with WHERE `status='draft'` (race-safe) and sets `publishAt` based on industry default.
4. **Alerts:** Vercel Cron hits `/api/cron/check-alerts` every hour with `Bearer ${CRON_SECRET}` → `checkStalePosts` and `checkRegenLimits` query for matching posts, send Resend emails, and stamp `alertedAt` / `regenLimitAlertedAt` for idempotency.

### Key Abstractions

- **`src/lib/authorization.ts`** — the only correct way for an API route to learn the active client. `requireClientAccess(requestedClientId)` is the linchpin of multi-tenant isolation.
- **`src/lib/posts/repository.ts`** — every post mutation lives here, and every WHERE clause includes `clientId`. The status-transition guards (WHERE `status='draft'`) are well thought out.
- **`src/proxy.ts`** — a thin session-cookie gate; explicitly documented as not replacing route-level authz.
- **`src/lib/posts/config.ts`** — single source of truth for `MAX_REJECTIONS`, `INDUSTRY_POST_TIMES`, `DEFAULT_POST_TIME`.

---

## 3. Strengths (Preserve These)

1. **Multi-tenant discipline in the repository layer.** Every post-touching function takes `(db, postId, clientId)` and includes `eq(posts.clientId, clientId)` in the WHERE clause. This is exactly what CLAUDE.md §10 demands.
2. **State-machine guards in UPDATEs.** `approvePost`, `rejectPost`, `regeneratePost` all include `eq(posts.status, "draft")` in the WHERE clause, so two simultaneous clicks can't double-transition a post. The `assertChanged` helper turns a 0-row UPDATE into an explicit error.
3. **Atomic regeneration.** `replacePostsForOpenDays` wraps DELETE+INSERT in a transaction, and `LOCKED_STATUSES` (`approved`, `published`, `failed`) are never deleted. This is the right shape for the per-day regeneration semantics in the spec.
4. **Unique index `(clientId, scheduledDate, platform)`.** Prevents duplicate posts for the same day/platform even if generation logic has a bug.
5. **Idempotent alert stamping.** Both `markPostAlerted` and `markPostRegenLimitAlerted` use `IS NULL` in the WHERE clause so a retry never sends two emails.
6. **CRON_SECRET enforcement.** `src/app/api/cron/check-alerts/route.ts` refuses to run if the env var is missing — fail-closed, not fail-open.
7. **The `authorization.ts` module exists and is used everywhere.** Most early-stage projects scatter `session.user.role !== "admin"` checks inline; centralizing this is a meaningful win.
8. **Magic-link sign-in restricted to existing users.** `auth.ts`'s `signIn` callback rejects unknown emails — Stefan provisions clients via the admin flow first.
9. **Audit log for deletions.** `deletionAuditLog` records who deleted whom and when. Good defensive habit.
10. **`.gitignore` correctly excludes `sqlite.db`, `.env*`, `.superpowers/`, `.claude/settings.local.json`, `.mcp.json`, and `public/generated/`.** Secrets and prototype artifacts won't leak.
11. **Postgres migration plan is exceptionally well-written.** `docs/superpowers/plans/2026-05-11-postgres-migration.md` is a complete, agent-executable spec — preserve this practice.

---

## 4. Issues Found

### CRITICAL

#### C1. Project is in an inconsistent migration state — won't build or run

- **What's wrong:** `src/db/schema.ts` and `drizzle.config.ts` have been rewritten for Postgres (Tasks 1–2 of the migration plan are committed). Everything downstream is still SQLite: `src/db/index.ts` imports `better-sqlite3` and calls `new Database("sqlite.db")`; `src/test/db.ts` is SQLite-in-memory; `src/lib/posts/repository.ts` imports `BetterSQLite3Database` and uses `.get()` / `.all()` / `.run()` everywhere; `src/lib/alerts/check-stale-posts.ts` and `check-regen-limits.ts` likewise; all admin/dashboard pages and scripts still use `.all()` / `.get()` / `.run()`.
- **Why it matters:** `npx tsc --noEmit` will fail across the project. The dev server can't start because `better-sqlite3` was uninstalled (commit `1a52075`) but the imports remain. The 6 stale SQLite migration files in `src/db/migrations/` will not apply against a Postgres database. The plan explicitly says this state is expected mid-task — but it should be finished before anything else lands on the branch.
- **Files:** `src/db/index.ts`, `src/test/db.ts`, `src/lib/posts/repository.ts`, `src/lib/alerts/check-stale-posts.ts`, `src/lib/alerts/check-regen-limits.ts`, all of `src/app/admin/**`, `src/app/dashboard/page.tsx`, `src/lib/auth.ts`, `scripts/*.ts`, `src/db/migrations/0000_*.sql` through `0005_*.sql`.
- **Fix:** Execute Tasks 3–8 of `docs/superpowers/plans/2026-05-11-postgres-migration.md` (db/index, test/db, repository sync→async, all call sites, delete old migrations, regenerate, run tests). Do not start any new feature work on this branch until tsc and `npm test` are green.

#### C2. Stale SQLite migration files on disk

- **What's wrong:** `src/db/migrations/0000_nervous_mercury.sql` through `0005_secret_blockbuster.sql` are SQLite-dialect (`integer`, backtick-quoted identifiers). They are tracked in git but the schema is now Postgres. If `npm run db:migrate` runs against the Neon database with these files present, drizzle-kit will attempt to apply SQLite DDL and either fail noisily or, worse, partial-apply tables before erroring.
- **Why it matters:** Anyone (including a future agent) running the migration command will hit an unrecoverable mismatch with no clear hint that the SQL is for the wrong dialect. The journal file (`meta/_journal.json`) tells drizzle-kit these migrations were applied, which compounds the confusion.
- **Files:** `src/db/migrations/*.sql`, `src/db/migrations/meta/*.json`.
- **Fix:** As specified in plan Task 5: delete every SQL file and meta snapshot, regenerate from the new Postgres schema with `npm run db:generate`. The single new `0000_<auto>.sql` is the only correct migration.

#### C3. `scripts/smoke-regen-limit.ts` connects directly to `sqlite.db`

- **What's wrong:** This untracked script (visible in `git status`) hardcodes `new Database("sqlite.db")` and uses sync `.all()`/`.run()`/`.get()`. It will run if someone invokes it, mutate a non-existent SQLite file (or worse, an old leftover one), and produce misleading "no draft posts" output.
- **Files:** `scripts\smoke-regen-limit.ts`
- **Fix:** Rewrite to import `db` from `@/db` and use awaited Drizzle queries — same pattern as the rest of the migration. Or delete it if it was a one-time tool that has served its purpose.

---

### HIGH

#### H1. In-memory rate limiter cannot survive the migration's goal

- **What's wrong:** `src/lib/rate-limit.ts` and `src/lib/request-rate-limit.ts` store counters in a JavaScript `Map`. The handoff doc at `docs/handoffs/2026-05-11-security-dashboard-image-report.md` already flags this. The whole point of migrating to Postgres is to enable Vercel deployment, which means multiple serverless function instances — each with its own in-memory map.
- **Why it matters:** Effective rate limit becomes `MAX_REQUESTS × number_of_concurrent_instances`. The magic-link 5-per-15-min limit is the most exploitable: an attacker hitting Vercel can bypass it cheaply once functions cold-start in parallel.
- **Files:** `src/lib/rate-limit.ts`, `src/lib/request-rate-limit.ts`, `src/lib/auth.ts` (uses `isRateLimited`).
- **Fix:** Two options aligned with the free-tier budget:
  1. Use the existing Postgres database as the rate-limit store (a `rate_limits` table keyed by `(scope, key, windowStart)`). Cheap, no new dependency, no new service.
  2. Add `@upstash/ratelimit` + `@upstash/redis` later when the first paying client justifies a Redis tier. Until then, option 1 is preferable.
- **Decision rationale to surface to the developer:** option 1 keeps the budget constraint and is good enough until launch.

#### H2. `src/data/clients/cafe-de-hoek.ts` and `public/generated/cafe-de-hoek/*` are prototype leakage

- **What's wrong:** CLAUDE.md §1 says "Three earlier prototypes exist… they are reference material only — Social AI does not import their code." But `src/app/admin/generate-preview/page.tsx` imports `CAFE_DE_HOEK_CLIENT_ID` from `src/data/clients/cafe-de-hoek.ts`, and locally there are images in `public/generated/cafe-de-hoek/` attached to that hardcoded client. The handoff doc notes this was done for local visual review.
- **Why it matters:** Two coupled risks. First, an admin page hard-couples to a specific test client ID — any deploy where that client doesn't exist will 500. Second, the convention "no prototype code in Social AI" is already eroded; if it stays, the line will keep moving.
- **Files:** `src/data/clients/cafe-de-hoek.ts`, `src/app/admin/generate-preview/page.tsx`, `src/app/admin/generate-preview/generate-preview-client.tsx`, `public/generated/cafe-de-hoek/*` (gitignored but present locally).
- **Fix:** Make `/admin/generate-preview` accept a `clientId` from the URL (`/admin/clients/[id]/generate-preview`) or a `<select>` on the page that lists real clients. Delete `src/data/clients/cafe-de-hoek.ts`. The generated test images can stay in `public/generated/` since they're gitignored, but they should not be referenced from app code.

#### H3. `src/app/api/admin/delete-user/route.ts` does not delete client/photo/post data

- **What's wrong:** The route deletes from `verificationTokens`, `sessions`, `accounts`, `users` — and relies on the `users → clients` FK `onDelete: "cascade"` to take down clients, photos, and posts transitively. That cascade chain does exist in the schema. But: (a) the audit log records only the user, not the count of related rows destroyed; (b) the comment in the route says "Hard delete from all auth tables" — auth-only delete is the documented intent, which conflicts with the cascade reality; (c) there is no admin-side confirmation UI; the front-end button posts JSON straight to the route.
- **Why it matters:** CLAUDE.md §10 says "Never delete data without explicit confirmation." Cascading a single click into "delete every post, every photo, every approval history for this client" is a foot-gun. The audit log won't tell Stefan how much was lost.
- **Files:** `src/app/api/admin/delete-user/route.ts`, `src/app/admin/delete-user-button.tsx`.
- **Fix:** (1) Make the delete-user button open a typed-confirmation modal ("type the client business name to confirm"). (2) Before the delete, count the dependent rows and write them into `deletionAuditLog` (extend the schema with `deletedClientCount`, `deletedPostCount`, `deletedPhotoCount` — small additive change). (3) Decide explicitly whether the cascade is intentional and document it in the route.

#### H4. `accounts` table is unused for magic-link auth and may interact oddly with DrizzleAdapter

- **What's wrong:** The Auth.js DrizzleAdapter requires an `accounts` table, but the Resend magic-link provider never writes to it (magic links don't create OAuth accounts). The table will be empty in production. This is fine — but `expires_at` was specifically converted from `integer` to `bigint` in the migration ("to match the Auth.js Postgres adapter shape"), which is correct, just worth verifying once a magic-link login round-trips against the real Neon database.
- **Why it matters:** Low-likelihood adapter-mismatch bugs are very expensive to debug after launch.
- **Files:** `src/db/schema.ts` (`accounts`), `src/lib/auth.ts`.
- **Fix:** Add a smoke test that does a full magic-link login against PGlite in CI (or at minimum, document this as a manual step in the migration plan's Task 9.3 — it's already there, just make sure it actually runs).

---

### MEDIUM

#### M1. `src/lib/posts/actions.ts::getClientIdForSession` duplicates `requireClientAccess` logic

- **What's wrong:** `getClientIdForSession` re-implements client-id lookup from session, while `lib/authorization.ts::requireClientAccess` does the same thing with better error handling and admin support.
- **Why it matters:** Two ways to do the same authz check is exactly the failure mode `authorization.ts` was created to fix. The next bug fix to one will skip the other.
- **Files:** `src/lib/posts/actions.ts`, `src/lib/authorization.ts`.
- **Fix:** Replace `getClientIdForSession` with `await requireClientAccess(null)` (clients only — Server Actions are not used by admins for these flows). Drop the local helper.

#### M2. `src/app/admin/clients/actions.ts::createClient` duplicates Auth.js's session-based admin gate

- **What's wrong:** Server actions hand-roll `if (!session || session.user.role !== "admin")`. There's a `requireAdmin()` in `authorization.ts` that does this and throws `HttpError(403)` — but it isn't used here.
- **Why it matters:** Same DRY concern as M1. Less acute because server actions have a different error shape than API routes, so `requireAdmin` would need a small adaptation.
- **Files:** `src/app/admin/clients/actions.ts`, `src/app/api/admin/delete-user/route.ts` (also hand-rolls).
- **Fix:** Either wrap `requireAdmin()` in a Server-Action-friendly variant that returns `{ error }` rather than throwing, or accept the duplication and add a comment explaining why.

#### M3. Hard-coded inline styles instead of the established design system

- **What's wrong:** `src/app/admin/page.tsx`, `src/app/login/page.tsx`, `src/app/welcome/page.tsx`, and `src/app/admin/clients/page.tsx` use `style={{ ... }}` inline. The dashboard layout (`src/app/dashboard/layout.tsx`) and components use CSS custom properties (`var(--surface-bg)`, `var(--text-muted)`) and Tailwind. Two style systems coexist.
- **Why it matters:** CLAUDE.md doesn't take a hard stance, but the spec's "Feels Human" framing and `~/.claude/rules/web/design-quality.md` warn against generic AI-template UI. Inline `#1a1a1a` everywhere on admin/auth pages is exactly the template smell. The dashboard already has the right pattern.
- **Files:** `src/app/admin/page.tsx`, `src/app/login/page.tsx`, `src/app/welcome/page.tsx`, `src/app/admin/clients/page.tsx`, `src/app/admin/clients/[id]/page.tsx`, `src/app/admin/clients/new/page.tsx`.
- **Fix:** Defer until the developer chooses to polish the admin/auth surfaces. When that happens, lift everything to Tailwind + CSS tokens to match the dashboard.

#### M4. `src/app/admin/page.tsx::AdminPage` lists ALL users without pagination or filtering

- **What's wrong:** `db.select().from(users).all()` returns every row. There's no admin-side filtering, search, or pagination.
- **Why it matters:** At the spec's 5–10 client scale, irrelevant. At 100 clients, the page is unusable; at 10k, it's a denial-of-service against the admin's browser.
- **Files:** `src/app/admin/page.tsx`.
- **Fix:** Add pagination (`.limit(50).offset(...)`) when the next set of admin features is built. Not urgent.

#### M5. Publishing pipeline does not yet exist

- **What's wrong:** The spec promises automatic publishing of approved posts to Meta. Schema fields (`publishAt`, `publishedAt`, `publishError`) and the `posts_status_publish_idx` index are in place — but no API route or cron handler dispatches publishes. The only cron is `/api/cron/check-alerts`.
- **Why it matters:** This is documented as in-scope for v1 in the spec. It's a known gap, not a bug, but worth surfacing as a planned feature with structural support already in the schema.
- **Files:** none yet — `src/app/api/cron/` would gain a `publish-approved/route.ts`.
- **Fix:** When this lands, the cron should query `posts WHERE status='approved' AND publishAt <= now() AND publishedAt IS NULL`, attempt publish via Meta API, then UPDATE to `published` or `failed` with `publishError`. Reuse the `Bearer ${CRON_SECRET}` gate pattern from `check-alerts`.

#### M6. `getClientPostTime` does a synchronous client lookup on every approval

- **What's wrong:** Every call to `approvePost` re-queries the `clients` table to fetch `industry` to compute `publishAt`. Approvals are not frequent, so this is fine — but the lookup happens inside a function that's hot on the request path.
- **Files:** `src/lib/posts/repository.ts` (`getClientPostTime`).
- **Fix:** Optionally accept the industry as a parameter or memoize per request. Not worth doing right now.

---

### LOW

#### L1. `crypto.randomUUID()` in `$defaultFn` is Edge-runtime safe but worth confirming

Schema uses `crypto.randomUUID()` from the global. Node 19+ and Edge runtimes both support it. No action required, just an item to keep an eye on if Vercel changes runtime defaults.

#### L2. Missing `.env.example` file

CLAUDE.md §6 references a `.env.example`. The glob didn't find one. The plan's Task 10.1 creates it; until then, anyone cloning the repo has no documented list of required env vars.

- **Fix:** Create `.env.example` with placeholders for `DATABASE_URL`, `AUTH_SECRET`, `AUTH_RESEND_KEY`, `EMAIL_FROM`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`, `BLOB_READ_WRITE_TOKEN`, `ADMIN_EMAIL`.

#### L3. Inline HTML email templates in `src/lib/auth.ts`

The magic-link email HTML lives as a 14-line string literal in the middle of `auth.ts`. It's mixed with auth config.

- **Fix:** Extract to `src/lib/emails/magic-link.ts` when the email count grows beyond 2 (welcome + magic-link + stale + regen-limit = already 4 distinct templates spread across files). Group them.

#### L4. `src/lib/auth.ts` does not initialize Resend client lazily

`const resendClient = new ResendClient(AUTH_RESEND_KEY)` runs at module load. The `throw new Error(...)` for the missing key fires on import. This is fine for serverful apps; on Vercel, the env var is always present, so this is harmless. Worth a comment though.

#### L5. `vercel.json` has only one cron job

Just the check-alerts hourly cron. Once the publishing pipeline (M5) is built, a second cron entry will be needed. Not a bug.

---

## 5. Recommended Execution Plan

Each item is sized **S** (1–2 hours), **M** (half-day), **L** (full day or more) and is a self-contained branch.

### Phase 1 — Unbreak the project (do this first, in this order)

1. **Finish Postgres migration Tasks 3–5** (db/index.ts, test/db.ts, regenerate migrations). **M.** Branch already exists: `feat/postgres-migration`.
2. **Finish Postgres migration Tasks 6–7** (convert `repository.ts` sync→async, then every call site). **L.** Same branch.
3. **Fix or delete `scripts/smoke-regen-limit.ts`.** **S.** Same branch.
4. **Run Tasks 8–9** (`npm test`, `tsc`, local smoke test). **S.** Same branch.
5. **Open and merge the migration PR** (Task 12). **S.** Stops the bleeding.

### Phase 2 — Lock in security gains from the migration

6. **Move rate limiting to Postgres-backed storage.** **M.** New branch `feat/db-rate-limit`. Adds a `rate_limits` table, replaces in-memory Map. Closes H1.
7. **Add typed-confirmation modal for user deletion + extend audit log row counts.** **M.** New branch `feat/delete-user-confirmation`. Closes H3.
8. **Add `.env.example`.** **S.** Same branch as the migration, or a tiny standalone one. Closes L2.

### Phase 3 — Remove prototype leakage

9. **Decouple `/admin/generate-preview` from Cafe de Hoek.** **M.** New branch `feat/generate-preview-any-client`. Adds client-picker UI, deletes `src/data/clients/cafe-de-hoek.ts`. Closes H2.
10. **Replace `getClientIdForSession` with `requireClientAccess`.** **S.** New branch `refactor/posts-actions-authz`. Closes M1.
11. **Adapt `requireAdmin` for Server Actions, use it in `admin/clients/actions.ts` and `admin/delete-user/route.ts`.** **S.** Closes M2.

### Phase 4 — Ship the missing v1 feature

12. **Implement the auto-publish cron.** **L.** New branch `feat/publish-approved-posts`. New `/api/cron/publish-approved/route.ts` + Meta API client. Closes M5.

### Phase 5 — Polish (defer until first client is on the horizon)

13. **Lift admin/auth pages to Tailwind + tokens to match dashboard.** **M.** Closes M3.
14. **Add admin user-list pagination.** **S.** Closes M4.
15. **Group all email templates under `src/lib/emails/`.** **S.** Closes L3.

---

## 6. What NOT to Change

These look odd at first glance but are intentional. Leave them alone unless you have a specific reason.

1. **`src/proxy.ts` (not `middleware.ts`).** Next.js 16 renamed middleware to proxy. The file name and location (`src/proxy.ts`, not project root) are correct for a project using `src/app/`. The handoff document confirms the build sees `ƒ Proxy (Middleware)`.
2. **Proxy doesn't enforce role-based authz.** It only checks for the presence of a session cookie. Role and ownership checks live server-side in `requireAdmin` / `requireClientAccess`. The proxy comment explicitly documents this — it is correct.
3. **`accounts` table is empty.** Auth.js's DrizzleAdapter requires it even though the Resend magic-link provider never writes rows. Don't drop the table.
4. **Status enums are `text` columns, not `pgEnum`.** This is a deliberate choice in the migration plan to avoid `CREATE TYPE` ceremony. Greenfield with TypeScript-side enum constraints is fine.
5. **IDs are `text` UUIDs filled by `crypto.randomUUID()`, not Postgres `uuid` with `gen_random_uuid()`.** Same rationale: minimize change variables in the migration. Don't switch now.
6. **`scheduledDate` is `text("YYYY-MM-DD")`, not `date`.** Stores the local-day intent without timezone math collisions. Mixed-timezone reasoning has bitten this kind of app before — keep the string.
7. **`publishAt` is built in local server time (not UTC).** `buildPublishAt` uses `new Date(year, month-1, day, hour, minute)` which is local-time. That works because Vercel sets the runtime to UTC and the cron uses UTC. If you ever read this and think "this should be UTC explicitly" — verify behavior end-to-end before changing; the current logic is consistent if not pretty.
8. **`firstSeenAt` is stamped on every dashboard render.** Looks wasteful, but the UPDATE has `IS NULL` in the WHERE clause, so it's a no-op for already-seen posts. Documented in the function comment.
9. **`regen-limit` and `stale-post` alert checks both gate on `isWithinNLBusinessHours`.** Stefan doesn't want alert spam at 3am. Correct.
10. **The Postgres migration plan does NOT migrate data.** Greenfield, no real users. Correct decision.
11. **Inline HTML emails contain Dutch text.** That's the actual product language. Not a missing translation.
12. **The `Db` type alias is `BetterSQLite3Database<typeof schema>` in many files right now.** Will be `NeonDatabase<typeof schema>` after Phase 1. Don't fix this in isolation — it's part of the migration.
13. **Old SQLite migrations still in the migrations folder.** They will be deleted in Phase 1, Task 5. Don't delete them in a separate commit before the schema regeneration step or drizzle-kit's journal gets confused.

---

## 7. Parallel Work Considerations

This project is built and improved with multiple features in flight at once. The phased plan above is **priority order**, not **strict sequence**. The following items can safely run in parallel branches once Phase 1 (the migration) is merged:

| Can run in parallel | Why it's safe |
|--------------------|---------------|
| Phase 2 items #6, #7, #8 | Different files, no schema collisions if rate-limit migration is generated first |
| Phase 3 items #10, #11 | Both touch authorization helpers but in different call sites |
| Phase 4 item #12 (publish cron) and any Phase 3 item | Different surface area |
| Phase 5 #13 (UI polish) and any backend work | Frontend vs backend |

Items that **must be sequenced**:

- **Phase 1 #1 → #2 → #3 → #4 → #5 are strictly ordered.** The migration is one unit of work on one branch. Do not parallelize within it.
- **Phase 2 #6 (rate-limit table) blocks any other schema migration** until merged, because drizzle-kit generates one migration at a time and parallel branches will collide on migration filenames.
- **Phase 3 #9 (decouple Cafe de Hoek)** blocks any work in `/admin/generate-preview/` until merged, to avoid merge conflicts.

**Coordination rule for parallel branches:**
- Each parallel branch owns its own slice of the codebase. If two branches need to touch the same file, the second one waits.
- Schema changes are serialized — only one branch at a time generates a new Drizzle migration. The next branch rebases before generating.
- Each parallel branch finishes with its own PR. No long-lived feature branches.

---

## Reference: Files Read During This Review

Architecture-relevant files read end-to-end:

- `CLAUDE.md`, `docs/social-ai-spec.md`
- `docs/superpowers/plans/2026-05-11-postgres-migration.md`
- `docs/handoffs/2026-05-11-security-dashboard-image-report.md`
- `package.json`, `drizzle.config.ts`, `vercel.json`, `.gitignore`
- `src/db/schema.ts`, `src/db/index.ts`, `src/test/db.ts`
- `src/proxy.ts`
- `src/lib/auth.ts`, `src/lib/authorization.ts`, `src/lib/rate-limit.ts`, `src/lib/request-rate-limit.ts`
- `src/lib/posts/repository.ts`, `src/lib/posts/actions.ts`, `src/lib/posts/types.ts`
- `src/lib/alerts/check-stale-posts.ts`, `src/lib/alerts/check-regen-limits.ts`
- `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/login/page.tsx`, `src/app/welcome/page.tsx`
- `src/app/dashboard/page.tsx`, `src/app/dashboard/layout.tsx`
- `src/app/admin/page.tsx`, `src/app/admin/clients/page.tsx`, `src/app/admin/clients/[id]/page.tsx`
- `src/app/admin/clients/actions.ts`, `src/app/admin/generate-preview/page.tsx`
- `src/app/api/posts/route.ts`, `src/app/api/generate-posts/route.ts`
- `src/app/api/photos/upload/route.ts`, `src/app/api/photos/[id]/analyze/route.ts`
- `src/app/api/cron/check-alerts/route.ts`, `src/app/api/admin/delete-user/route.ts`
- `src/components/dashboard/post-card.tsx`
- `scripts/smoke-regen-limit.ts`
- `src/db/migrations/0000_nervous_mercury.sql`
