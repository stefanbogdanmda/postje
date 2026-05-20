# Production Readiness Report — Postje

> **Date:** 2026-05-18
> **Compiled by:** Coordinator 2 (swarm consolidation)
> **Sources:** 5 domain audits (database, security, backend, frontend, testing/deployment) + 2 scout reports
> **Full audit documents:** `docs/audit-database.md`, `docs/audit-security.md`, `docs/audit-backend.md`, `docs/audit-frontend.md`, `docs/audit-testing-deployment.md`

---

## Executive Summary

Postje has a **solid architectural foundation** — clean schema with proper tenant isolation, AES-256-GCM encrypted token storage, invite-only authentication, repository pattern for data access, and 21 test files covering critical business logic. The codebase is well-organized and follows good patterns for a v1 product.

However, the project is **not yet production-ready**. The most significant gap is the **missing publisher engine** — the system can generate, review, and approve posts, but cannot publish them to Instagram or Facebook. This is the product's core value proposition.

Beyond the publisher, there are approximately **8 critical items, 15 high-priority items, and 20+ medium/low improvements** needed before confidently serving paying clients.

**Estimated effort to reach production:** 15-20 focused work sessions.

---

## What's Already Working Well

These are genuine strengths of the codebase that should be preserved:

1. **Tenant isolation** — Every database query filters by `clientId`. The `requireClientAccess()` function enforces this at the authorization layer. No shortcuts, no exceptions.

2. **Encrypted token storage** — Meta access tokens use AES-256-GCM with random IVs and authenticated tags. The encryption key never touches the database.

3. **Invite-only authentication** — The `signIn` callback rejects any email not in the `users` table. Open registration is impossible. Magic links with database-backed sessions and 30-day expiry.

4. **HMAC-signed OAuth state** — Meta OAuth flow uses HMAC-SHA256 signed, time-boxed (10 min) state tokens with timing-safe comparison. Prevents CSRF and replay attacks.

5. **Repository pattern + dependency injection** — Data access is abstracted behind repository functions that accept `db` as a parameter. Tests use PGlite (in-memory Postgres) for true isolation.

6. **Transactional integrity** — Atomic operations where needed. SERIALIZABLE isolation for rate limiting. Optimistic concurrency for post approval/rejection.

7. **GDPR deletion pipeline** — 24-hour cooling-off period, email confirmation with cancel token, cron-driven execution, audit logging, and cascade cleanup including blob deletion.

8. **Parameterized queries everywhere** — Drizzle ORM prevents SQL injection. No raw SQL found anywhere in the codebase.

9. **Rate limiting** — Database-backed (survives serverless instance recycling). Magic link throttle uses serializable transactions to prevent race conditions.

10. **Clean migration history** — 4 additive-only migrations. No destructive operations.

---

## Critical Items (Must Fix Before Launch)

These items block a production launch. No paying client should use the system until these are resolved.

### 1. Build the Publisher Engine

**Source:** Backend audit, Database audit, Testing audit
**Impact:** The product's core value proposition — "we post for you" — doesn't work.

Posts can be generated, reviewed, and approved, but **nothing ever publishes them**. The `publishAt` timestamp is set on approval, but no code reads it. A detailed 13-task implementation plan exists at `docs/superpowers/plans/2026-05-12-publisher-engine.md` but zero code has been written.

**What's needed:**
- Cron job at `/api/cron/publish-posts` (query `status = 'approved' AND publishAt <= now`)
- Meta Graph API integration to create posts on Pages/IG Business Accounts
- Decrypt access token from `meta_connections`, use it, discard it
- Update post status to `published` or `failed` with timestamps and error messages
- Register the cron in `vercel.json`
- Add a `publish_attempts` table for debugging

### 2. Wire Up Auth Middleware

**Source:** Backend audit, Security audit, Frontend audit
**Impact:** No defense-in-depth for route protection.

`src/proxy.ts` exists with route protection logic, but there is no `src/middleware.ts` to invoke it. Every page relies on individual `auth()` calls. If a developer adds a new `/dashboard/*` or `/admin/*` route and forgets the check, it's unprotected.

**Fix:** Create `src/middleware.ts` that imports and delegates to `proxy.ts`. Takes ~5 minutes.

### 3. Add Security Headers

**Source:** Security audit
**Impact:** Vulnerable to clickjacking, MIME-sniffing attacks, no HSTS enforcement.

`next.config.ts` is empty. No CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, or Permissions-Policy. Single file change with large security improvement.

### 4. Fix `publishAt` Timezone Bug

**Source:** Database audit
**Impact:** Posts will publish 1-2 hours early for Dutch clients.

`buildPublishAt()` constructs dates using the **server's local timezone** (UTC on Vercel), not the client's timezone. "08:00" becomes 08:00 UTC, not 08:00 Amsterdam time.

**Fix:** Store timezone per client in `clients` table. Use timezone-aware date construction.

### 5. Separate Dev and Prod Databases

**Source:** Testing/deployment audit
**Impact:** Dev work could corrupt production data.

CLAUDE.md acknowledges "the dev server connects to the same Neon instance as production" as acceptable during the build phase. However, before onboarding paying clients, a separate Neon branch or database should be configured for development to prevent accidental data corruption.

### 6. Add CI/CD Pipeline

**Source:** Testing/deployment audit
**Impact:** No automated quality gate. Code can reach `main` with type errors, test failures, or lint issues.

No `.github/workflows/` exists. Create a workflow with: lint, type-check, test, build. Enable branch protection on `main`.

### 7. Fix Cron Secret Timing Attack

**Source:** Security audit
**Impact:** Cron secret potentially extractable via timing analysis.

Both cron routes use `!==` for secret comparison instead of `crypto.timingSafeEqual()`. Two-line fix per route.

### 8. Add Input Validation (Zod)

**Source:** Security audit, Backend audit
**Impact:** Malformed/malicious input reaches business logic unchecked.

API request bodies are parsed with bare `request.json()` and cast with `as`. No runtime validation anywhere. Add Zod schemas for all API endpoints.

---

## High Priority (Before First Paying Client)

These items should be fixed before onboarding a real paying client, but don't block development.

| # | Item | Source | Effort |
|---|------|--------|--------|
| 9 | **Rate limit all unprotected routes** — `/api/posts`, `/api/admin/delete-user`, Meta OAuth routes, deletion cancel | Backend, Security | Small per route |
| 10 | **Fix admin CSS variables** — `MetaConnectionPanel` uses `--admin-*` vars that are never defined. Broken styles. | Frontend | Small |
| 11 | **Add `loading.tsx` and `error.tsx` files** — Users see blank screens or raw errors during SSR | Frontend | Small |
| 12 | **Add navigation to `/dashboard/account`** — GDPR features exist but are unreachable from the UI | Frontend | Tiny |
| 13 | **Fix PostSlideOver accessibility** — Missing `role="dialog"`, `aria-modal`, `aria-labelledby`, focus trapping | Frontend | Medium |
| 14 | **Build Stefan's Attention Dashboard** — Core spec requirement: rejection limits, approval timeouts, flagged posts, calibration | Frontend + Backend | Large |
| 15 | **Add flag/cancel buttons on posts** — Spec requires flag on published, cancel on approved-but-unpublished | Frontend + Backend | Medium |
| 16 | **Make client profiles database-driven** — Currently hardcoded to one persona. Need per-client tone, banned phrases, personality. | DB + Backend | Large |
| 17 | **Switch photos to private blob storage** — Currently `access: "public"`. Use signed URLs. | Backend | Medium |
| 18 | **Add Meta token refresh** — Long-lived tokens expire after ~60 days with no refresh logic | Backend | Medium |
| 19 | **Add test coverage measurement** — Install `@vitest/coverage-v8`, configure 80% threshold | Testing | Small |
| 20 | **Test `lib/authorization.ts`** — Security-critical code with zero test coverage | Testing | Medium |
| 21 | **Test API route handlers** — Only Meta routes have tests. Other routes untested. | Testing | Large |
| 22 | **Add health check endpoint** — `/api/health` verifying DB connectivity for uptime monitoring | Backend | Tiny |
| 23 | **Add error monitoring (Sentry)** — Console.error only. No alerting on production errors. | Infra | Small |

---

## Medium Priority (Production Quality)

| # | Item | Source |
|---|------|--------|
| 24 | Add `photos.clientId` index — missing, causes full table scans | Database |
| 25 | Fix `posts.photoId` FK strategy — add `onDelete: "set null"` | Database |
| 26 | Wrap `createClient` in a transaction — prevents orphan user rows | Database |
| 27 | Add `updatedAt` trigger or Drizzle wrapper | Database |
| 28 | Clean up expired `auth_throttle` / `verificationTokens` / `sessions` rows via cron | Database |
| 29 | Standardize admin auth on `requireAdmin()` (some use manual role check) | Security |
| 30 | Derive separate signing keys from `AUTH_SECRET` via HKDF | Security |
| 31 | Add unified env var validation at startup | Deployment |
| 32 | Make admin pages responsive (currently desktop-only) | Frontend |
| 33 | Unify styling approach (mixed inline styles vs Tailwind) | Frontend |
| 34 | Adopt shadcn/ui for form controls, buttons, dialogs | Frontend |
| 35 | Use Next.js `<Image>` for photo optimization | Frontend |
| 36 | Extract `formatDutchDate` to shared utility (duplicated 4x) | Frontend |
| 37 | Export shared `Db` type from `db/index.ts` (duplicated 8+ files) | Database |
| 38 | Set explicit pool limits on Neon connection | Database |
| 39 | Install Prettier + Husky for pre-commit hooks | Tooling |
| 40 | Add Playwright E2E tests for login, dashboard, and admin flows | Testing |
| 41 | Consistent API response envelope `{ success, data, error }` | Backend |
| 42 | Fix `ADMIN_EMAIL` silently undefined — alert emails fail silently | Config |
| 43 | Add dark mode token completion or remove dark media query | Frontend |

---

## Low Priority (Nice to Have)

- `scheduledDate` as text → consider migrating to date column
- Dead `completedAt` column on `deletionRequests` → remove or use
- Postgres CHECK constraints for enum columns
- Database backup strategy documentation
- Database monitoring (connection pool, slow queries, storage)
- Comprehensive dev seed data script
- Visual regression tests (screenshot comparison)
- Lighthouse CI for performance budgets
- Dependabot / Renovate for dependency updates
- Remove leftover `sqlite.db` from project root
- Cookie configuration made explicit in Auth.js config
- CORS configuration for future external integrations
- API versioning

---

## Recommended Build Order

This is the suggested sequence for getting to production, organized as phases:

### Phase 1: Quick Security Wins (1-2 sessions)

1. Add security headers to `next.config.ts`
2. Create `src/middleware.ts` (wire up proxy.ts)
3. Fix cron secret timing attack (2 files)
4. Add rate limiting to unprotected routes
5. Verify `.env.example` is comprehensive (file exists but may be missing newer vars)

### Phase 2: Publisher Engine (3-5 sessions)

6. Fix `publishAt` timezone bug (add client timezone)
7. Build publisher cron job with Meta Graph API calls
8. Add `publish_attempts` table and migration
9. Register publish cron in `vercel.json`
10. Test publisher with sandbox Meta app

### Phase 3: Client Profiles & Attention Dashboard (3-4 sessions)

11. Add brand profile columns to schema (tone, banned phrases, personality, etc.)
12. Make AI prompt generation read from database
13. Build Stefan's Attention Dashboard (rejection limits, approval timeouts, calibration)
14. Add flag/cancel buttons on post cards

### Phase 4: Infrastructure & Testing (2-3 sessions)

15. Separate dev and prod databases
16. Add CI/CD pipeline (GitHub Actions)
17. Add Zod input validation to all API routes
18. Install coverage tooling, measure baseline
19. Add tests for authorization, AI modules, untested routes
20. Switch blob storage to private + signed URLs

### Phase 5: Polish & Launch Prep (2-3 sessions)

21. Add `loading.tsx` / `error.tsx` for all routes
22. Fix admin CSS, responsive design
23. Add navigation to account page
24. Fix accessibility issues (dialog ARIA, focus trapping, color contrast)
25. Add health check, Sentry integration
26. Add Meta token refresh logic
27. Final E2E smoke test of full user journey

---

## Spec Feature Coverage Matrix

| Feature (from spec) | Status | What's Built | What's Missing |
|---------------------|--------|--------------|----------------|
| Magic link authentication | DONE | Full flow with rate limiting | Silent failure on rate limit (UX issue) |
| Client dashboard — review posts | DONE | Card grid, slide-over, approve/reject/edit | No link to account page |
| Post generation with AI | DONE | Claude API integration, photo analysis | Hardcoded to one client profile |
| Auto-publishing to Meta | NOT STARTED | OAuth + token storage done | Publisher engine, cron, Meta API calls |
| Stefan's Attention Dashboard | NOT STARTED | Alert cron + email notification exists | No UI dashboard |
| Calibration period tracking | NOT STARTED | — | No schema, no UI |
| Client flag on published posts | NOT STARTED | — | No schema, no UI |
| Cancel approved-but-unpublished | NOT STARTED | — | No UI |
| GDPR data export | DONE | JSON download | No navigation link to page |
| GDPR account deletion | DONE | Full lifecycle with 24h grace | Working correctly |
| Admin client management | DONE | Create, edit, list clients | Meta connection panel has broken CSS |
| Meta OAuth integration | DONE | Connect/disconnect flow | Token refresh missing |
| Weekly post generation cycle | PARTIAL | Generation works | No batch scheduling for all clients |
| Posting time optimization | NOT STARTED | Timezone bug in current implementation | — |
| Banned phrases per client | NOT STARTED | Hardcoded in code | Needs schema + UI |
| Onboarding kickoff call | NOT STARTED | — | Needs transcript processing flow |
| Billing / subscription | OUT OF SCOPE (v1) | Manual billing per spec | — |
| TikTok integration | OUT OF SCOPE (v1) | — | — |

---

## Bottom Line

**What works:** The system successfully generates AI-powered social media posts, lets clients review and approve them, manages Meta OAuth connections with encrypted tokens, handles GDPR data export and deletion, and has solid authentication with proper tenant isolation.

**What's missing for launch:**
1. The publisher (the whole point of the product)
2. Security hardening (headers, middleware, input validation)
3. Dev/prod environment separation
4. CI/CD pipeline
5. Stefan's management dashboard

**What's the right next step:** Start with Phase 1 (quick security wins — 1-2 sessions), then Phase 2 (publisher engine — 3-5 sessions). These two phases close the biggest gaps and deliver the product's core value loop.

---

*This report consolidates findings from 5 independent domain audits. See the individual audit files in `docs/` for detailed findings, code references, and recommendations.*
