# Testing, CI/CD & Deployment Audit

**Auditor:** Builder 5
**Date:** 2026-05-18
**Scope:** Test infrastructure, test coverage, CI/CD pipelines, deployment configuration, environment management, cron jobs, build tooling

---

## Executive Summary

The project has a **solid unit test foundation** — 21 test files (~3,000 LOC, ~213 passing tests) using Vitest with PGlite for in-memory Postgres. Business-critical logic in `lib/` is well-covered. However, there is **no CI/CD pipeline**, **no automated coverage enforcement**, **no Playwright E2E tests**, and **no environment separation** (dev and prod share the same Neon database). These gaps make the project **not production-ready** from a testing and deployment perspective.

---

## 1. Unit Testing Infrastructure

### What Exists (GOOD)

| Aspect | Status | Details |
|--------|--------|---------|
| Framework | Vitest 4.1.5 | Modern, fast, good DX |
| Test DB | PGlite (in-memory Postgres) | `src/test/db.ts` — creates fresh DB per test via `createTestDb()` |
| Test helpers | `seedTestClient()`, `seedTestPhoto()` | Clean, reusable setup |
| Parallelism | Disabled (`fileParallelism: false`) | Correct for DB-heavy tests sharing schema |
| Test count | 21 test files | Good breadth for current codebase size |

### Tested Modules

| Module | Test File | LOC | Assessment |
|--------|-----------|-----|------------|
| `posts/repository` | `repository.test.ts` | 743 | Excellent — covers CRUD, tenant isolation, locked days, stale posts, regen limits |
| `posts/generate-posts` | `generate-posts.test.ts` | 194 | Good — covers generation logic |
| `posts/dates` | `dates.test.ts` | 64 | Good — date utilities |
| `posts/locked-days` | `locked-days.test.ts` | 32 | Adequate |
| `account/delete` | `delete.test.ts` | 172 | Good — GDPR deletion logic |
| `account/export` | `export.test.ts` | 200 | Good — GDPR data export |
| `account/deletion-request` | `deletion-request.test.ts` | 202 | Good — deletion request flow |
| `account/deletion-email` | `deletion-email.test.ts` | 67 | Adequate |
| `account/process-deletions` | `process-deletions.test.ts` | 81 | Adequate |
| `auth/throttle` | `throttle.test.ts` | 227 | Excellent — rate limit logic well-tested |
| `alerts/check-stale-posts` | `check-stale-posts.test.ts` | 128 | Good |
| `alerts/check-regen-limits` | `check-regen-limits.test.ts` | 135 | Good |
| `alerts/stale-post-email` | `stale-post-email.test.ts` | 55 | Adequate — email formatting |
| `alerts/regen-limit-email` | `regen-limit-email.test.ts` | 74 | Adequate |
| `time/business-hours` | `business-hours.test.ts` | 67 | Good |
| `meta/crypto` | `crypto.test.ts` | 45 | Good — encryption round-trip |
| `meta/oauth-state` | `oauth-state.test.ts` | 47 | Good |
| `meta/oauth` | `oauth.test.ts` | 166 | Good — URL construction, token exchange |
| `meta/repository` | `repository.test.ts` | 91 | Good |
| `api/meta/connect/start` | `route.test.ts` | 81 | Good — route handler testing |
| `api/meta/callback` | `route.test.ts` | 130 | Good — OAuth callback flow |

### Gaps in Unit Testing

| Gap | Severity | Details |
|-----|----------|---------|
| No tests for `lib/ai/*` | **HIGH** | `client-profile.ts`, `prompts.ts`, `validate-posts.ts`, `extract-json.ts`, `regenerate-post.ts` — no unit tests for AI prompt construction or JSON extraction. These are testable without calling Claude API. |
| No tests for `lib/authorization.ts` | **HIGH** | Authorization logic (`requireAdmin`, `requireClientOwner`) has no tests. This is security-critical. |
| No tests for `lib/request-rate-limit.ts` | **MEDIUM** | Request-level rate limiting untested |
| No tests for `lib/photos/*` | **MEDIUM** | `upload.ts` and `analyze.ts` have no tests |
| No tests for `lib/welcome-email.ts` | **LOW** | Email template formatting |
| No tests for `posts/actions.ts` | **MEDIUM** | Server actions for approve/reject/regenerate |
| No tests for any API route except Meta | **HIGH** | `generate-posts/route.ts` (309 LOC), `posts/route.ts`, `photos/upload/route.ts`, `admin/delete-user/route.ts`, cron routes — all untested |
| No tests for `db/schema.ts` | **LOW** | Schema is exercised indirectly via repository tests |

---

## 2. E2E Testing

### What Exists

| Script | Description | Requires |
|--------|-------------|----------|
| `scripts/e2e-post-pipeline.ts` | Full post generation pipeline (HTTP-level) | Running dev server + real Claude API (~$1/run) |
| `scripts/e2e-approval-flow.ts` | Approval workflow via repository layer | DB only (PGlite) |
| `scripts/smoke-regen-limit.ts` | Regen limit smoke test | Unknown |

### Assessment

- **Not real E2E tests** — These are custom scripts using `fetch()` against localhost, not a browser-based testing framework.
- **No Playwright** — No `playwright.config.ts`, no `@playwright/test` dependency, no `.spec.ts` files. The CLAUDE.md and project rules specify Playwright as the E2E framework, but it isn't set up.
- **No browser testing** — No login flow testing, no form interaction testing, no visual regression testing.
- **Manual execution only** — Run via `npm run test:e2e` / `npm run test:approval`, no automation.

### Gaps

| Gap | Severity | Details |
|-----|----------|---------|
| No Playwright setup | **CRITICAL** | No browser-based E2E tests for any user flow |
| No login flow E2E test | **CRITICAL** | Magic link authentication completely untested end-to-end |
| No client dashboard E2E test | **HIGH** | Post review, approve, reject flows untested in browser |
| No admin dashboard E2E test | **HIGH** | Client management, generate preview untested |
| No cross-browser testing | **MEDIUM** | No evidence of testing on Chrome, Firefox, Safari |
| No responsive testing | **MEDIUM** | No viewport/breakpoint testing |
| No accessibility E2E checks | **MEDIUM** | No axe-core or similar integration |

---

## 3. Test Coverage

### Current State

| Aspect | Status |
|--------|--------|
| Coverage tool installed | **NO** — `@vitest/coverage-v8` is listed as optional peer dep but NOT in `devDependencies` |
| Coverage configured in vitest.config | **NO** — no `coverage` block in config |
| Coverage enforcement | **NO** — no minimum threshold configured |
| Coverage reporting | **NO** — no reports generated |

### Estimated Coverage (Manual Analysis)

Based on comparing tested modules vs. total source:

| Layer | Tested LOC (approx) | Total LOC (approx) | Estimated Coverage |
|-------|---------------------|--------------------|--------------------|
| `lib/posts/*` | ~800 | ~914 | ~75% |
| `lib/account/*` | ~500 | ~631 | ~70% |
| `lib/auth/*` | ~227 | ~232 | ~90% (throttle only) |
| `lib/alerts/*` | ~392 | ~332 | ~80% |
| `lib/meta/*` | ~379 | ~458 | ~70% |
| `lib/ai/*` | 0 | ~489 | **0%** |
| `lib/authorization.ts` | 0 | ~93 | **0%** |
| `lib/photos/*` | 0 | ~115 | **0%** |
| `app/api/*` routes | ~211 | ~552+ | **~30%** |
| Components / Pages | 0 | ~1500+ | **0%** |

**Overall estimated coverage: ~40-50%** — well below the 80% target in CLAUDE.md.

---

## 4. CI/CD Pipeline

### Current State: **NONE**

| Aspect | Status |
|--------|--------|
| `.github/workflows/` | **Does not exist** |
| GitHub Actions | **Not configured** |
| Pre-commit hooks | **Not configured** |
| Automated lint on PR | **NO** |
| Automated type-check on PR | **NO** |
| Automated test run on PR | **NO** |
| Automated build check on PR | **NO** |
| Branch protection rules | **Unknown** (likely not configured) |

### Impact

- Code can be pushed to `main` without any automated quality gate
- Type errors, lint failures, and test failures are only caught manually
- No enforcement of the "main branch is always deployable" rule from CLAUDE.md

---

## 5. Deployment Configuration

### Vercel Setup

| Aspect | Status | Details |
|--------|--------|---------|
| `vercel.json` | Present | Configures 2 cron jobs only |
| `next.config.ts` | Minimal | Empty config — no custom settings |
| Framework detection | Automatic | Vercel auto-detects Next.js |
| Build command | Default `next build` | Via `package.json` scripts |
| Output mode | Default (serverless) | No custom output configuration |

### Cron Jobs

| Cron | Schedule | Auth | Assessment |
|------|----------|------|------------|
| `/api/cron/check-alerts` | Every hour (`0 * * * *`) | `CRON_SECRET` Bearer token | Good — proper auth check |
| `/api/cron/process-deletions` | Every hour (`0 * * * *`) | `CRON_SECRET` Bearer token | Good — proper auth check |

**Missing cron: No scheduled publishing cron.** The spec mentions "Approved posts scheduled and published at platform-appropriate times" — no cron or mechanism for this exists yet.

### Gaps

| Gap | Severity | Details |
|-----|----------|---------|
| No publish cron job | **CRITICAL** | Approved posts have no automated publishing mechanism |
| No health check endpoint | **HIGH** | No `/api/health` for uptime monitoring |
| No error monitoring | **HIGH** | No Sentry, LogRocket, or similar error tracking |
| No preview deployments config | **MEDIUM** | Vercel does this by default, but no PR-specific preview env vars |
| No custom headers/security headers | **MEDIUM** | No CSP, HSTS, X-Frame-Options configured in `next.config.ts` or `vercel.json` |

---

## 6. Environment Management

### Current State

| Aspect | Status | Risk |
|--------|--------|------|
| `.env.example` | Present | Good — documents required vars |
| `.env*` in `.gitignore` | Yes | Good — secrets not committed |
| Dev/Prod DB separation | **NO** | **CRITICAL** — `src/db/index.ts` uses `DATABASE_URL` which points to the same Neon instance for dev and prod. Note: CLAUDE.md explicitly acknowledges this limitation and states "A different DATABASE_URL should be configured for staging/preview when those environments exist." The severity remains CRITICAL because a developer mistake during development could corrupt production data. |
| Staging environment | **NO** | No separate staging/preview database |
| Env var validation at startup | Partial | `AUTH_RESEND_KEY` and `DATABASE_URL` throw on missing; others silently default |

### Environment Variables Found in Code

| Variable | Used In | Validated? |
|----------|---------|-----------|
| `DATABASE_URL` | `db/index.ts`, `drizzle.config.ts` | Yes — throws |
| `AUTH_RESEND_KEY` | `lib/auth.ts`, alerts, emails | Yes — throws in auth.ts; silent in alerts |
| `AUTH_SECRET` | `meta/oauth-state.ts` | Yes — throws |
| `EMAIL_FROM` | auth, alerts, emails | No — defaults to `onboarding@resend.dev` |
| `ADMIN_EMAIL` | alerts | No — silently undefined |
| `ANTHROPIC_API_KEY` | `lib/ai/client.ts` | Yes — throws |
| `CRON_SECRET` | cron routes | Partial — returns 500 but no startup check |
| `NEXT_PUBLIC_APP_URL` | multiple | No — defaults to `localhost:3000` |
| `META_APP_ID` | meta OAuth | Yes — throws |
| `META_APP_SECRET` | meta OAuth | Yes — throws |
| `META_OAUTH_REDIRECT_URI` | meta OAuth | Yes — throws |
| `META_TOKEN_ENCRYPTION_KEY` | meta crypto | Yes — throws |
| `META_GRAPH_VERSION` | meta config | No — defaults |

### Gaps

| Gap | Severity | Details |
|-----|----------|---------|
| Dev and prod share same database | **CRITICAL** | Violates CLAUDE.md rule. Tests and dev work could corrupt production data |
| No unified env validation | **HIGH** | Env vars checked in scattered locations; no single startup validation |
| `ADMIN_EMAIL` silently undefined | **HIGH** | Alert emails silently fail if `ADMIN_EMAIL` is not set |
| `CRON_SECRET` validated at request time, not startup | **MEDIUM** | Cron will return 500 on every invocation if not set, wasting Vercel function invocations |
| No `.env.test` or test env setup | **MEDIUM** | Tests manipulate `process.env` directly — fragile pattern |

---

## 7. Build & Lint Tooling

### Current State

| Tool | Status | Config |
|------|--------|--------|
| TypeScript | 5.x, strict mode | `tsconfig.json` — good defaults |
| ESLint | 9.x | `eslint.config.mjs` — next/core-web-vitals + typescript |
| Prettier | **Not installed** | No `.prettierrc`, no dependency |
| Stylelint | **Not installed** | No CSS linting |
| Husky / lint-staged | **Not installed** | No pre-commit hooks |

### npm Scripts

| Script | Command | Assessment |
|--------|---------|------------|
| `dev` | `next dev` | Standard |
| `build` | `next build` | Standard |
| `start` | `next start` | Standard |
| `lint` | `eslint` | Good — but no `--fix` option and unclear what it targets |
| `test` | `vitest run` | Good |
| `test:watch` | `vitest` | Good |
| `test:e2e` | `tsx scripts/e2e-post-pipeline.ts` | Manual E2E — not real Playwright |
| `test:approval` | `tsx scripts/e2e-approval-flow.ts` | Manual E2E — not real Playwright |
| `db:generate` | `drizzle-kit generate` | Good |
| `db:migrate` | `drizzle-kit migrate` | Good |
| `db:studio` | `drizzle-kit studio` | Good — data inspection |
| `seed:admin` | `tsx scripts/seed-admin.ts` | Good |
| `seed:cafe` | `tsx scripts/seed-cafe-de-hoek.ts` | Good |

---

## 8. Database Migrations

### Current State

| Aspect | Status |
|--------|--------|
| Migration tool | Drizzle Kit |
| Migrations directory | `src/db/migrations/` |
| Migration count | 4 migrations (0000–0003) |
| Snapshot files | Present (`meta/*.json`) |
| Journal | Present (`meta/_journal.json`) |
| Down migrations | **NOT SUPPORTED** by Drizzle Kit |
| Rollback strategy | **None documented** |

### Gaps

| Gap | Severity | Details |
|-----|----------|---------|
| No rollback strategy | **HIGH** | Drizzle Kit doesn't support down migrations. No documented procedure for reverting a bad migration. |
| No migration testing in CI | **HIGH** | Migrations only run via manual `npm run db:migrate` |
| No migration dry-run script | **MEDIUM** | No way to preview migration SQL before applying |
| sqlite.db in project root | **LOW** | Leftover from a previous iteration — not gitignored properly (it IS in .gitignore, but file exists locally) |

---

## 9. Production Readiness Scorecard

| Category | Score | Blockers |
|----------|-------|----------|
| Unit Tests | 6/10 | AI module, authorization, and routes untested |
| E2E Tests | 1/10 | No Playwright, no browser testing |
| Coverage | 3/10 | ~40-50% estimated, no measurement or enforcement |
| CI/CD | 0/10 | No pipeline exists |
| Deployment | 5/10 | Vercel works, but missing publish cron, health checks, monitoring |
| Environment | 3/10 | Shared dev/prod DB, inconsistent env validation |
| Build Tooling | 5/10 | TypeScript + ESLint present, no Prettier, no pre-commit hooks |
| Migrations | 5/10 | Working but no rollback or CI testing |

**Overall: 3.5/10 — Not production-ready**

---

## 10. Prioritized Action Items

### CRITICAL (Must fix before any client uses the system)

1. **Separate dev and prod databases** — Configure a separate Neon database (or branch) for development. Add `DATABASE_URL` overrides per environment in Vercel.
2. **Add CI/CD pipeline** — Create `.github/workflows/ci.yml` with: lint, type-check, test, build. Enable branch protection on `main`.
3. **Implement publish cron** — The core product promise (auto-publish approved posts) has no implementation.
4. **Add Playwright E2E tests** — At minimum: login flow, client dashboard review flow, admin client management.

### HIGH (Should fix before first paying client)

5. **Add test coverage measurement** — Install `@vitest/coverage-v8`, add coverage config to `vitest.config.ts`, set 80% threshold.
6. **Add tests for `lib/ai/*`** — Test prompt construction, JSON extraction, validation logic (mock the Claude API call).
7. **Add tests for `lib/authorization.ts`** — Security-critical code needs explicit test coverage.
8. **Add tests for API routes** — At least `generate-posts/route.ts`, `posts/route.ts`, cron routes.
9. **Add unified env validation** — Create a startup validation module that checks all required env vars and fails fast.
10. **Add error monitoring** — Integrate Sentry or similar (free tier available).
11. **Add health check endpoint** — Simple `/api/health` that verifies DB connectivity.
12. **Document migration rollback procedure** — Even if manual, document how to revert a bad migration.

### MEDIUM (Should fix for production quality)

13. **Install Prettier** — Consistent code formatting.
14. **Install Husky + lint-staged** — Pre-commit hooks for lint/format/type-check.
15. **Add security headers** — CSP, HSTS, X-Frame-Options via `next.config.ts` headers.
16. **Add `ADMIN_EMAIL` validation** — Alert emails silently fail without it.
17. **Add test environment setup** — `.env.test` or vitest `setupFiles` instead of scattered `process.env` manipulation.
18. **Add API route integration tests** — Test request/response contracts.

### LOW (Nice to have)

19. **Add visual regression tests** — Screenshot comparison for key pages.
20. **Add Lighthouse CI** — Automated performance budgets.
21. **Add dependency update automation** — Renovate or Dependabot.
22. **Clean up `sqlite.db`** — Leftover from a previous iteration.
