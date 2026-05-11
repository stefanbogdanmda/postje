# Rate-Limit Persistence — Implementation Plan

**Spec:** [docs/superpowers/specs/2026-05-12-rate-limit-persistence-design.md](../specs/2026-05-12-rate-limit-persistence-design.md)
**Branch:** `feat/rate-limit-persistence`
**Date:** 2026-05-12

Bite-sized TDD tasks. One commit per task. Each task has its own spec-compliance check + code-quality review before moving on.

---

## Task 1 — Add `authThrottle` table to schema

**What:** Add the `authThrottle` pgTable to [src/db/schema.ts](src/db/schema.ts). Generate a Drizzle migration with `npm run db:generate`.

**Files:**
- [src/db/schema.ts](src/db/schema.ts) — add the table definition
- `src/db/migrations/NNNN_add_auth_throttle.sql` — auto-generated

**Acceptance:**
- `npx tsc --noEmit` is green
- `npm run db:generate` produces exactly one new migration file with `CREATE TABLE "auth_throttle"` and the `auth_throttle_key_requestedAt_idx` index
- Existing tests still pass (`npm test`)

**Commit:** `feat(db): add auth_throttle table for persistent rate limiting`

---

## Task 2 — Write throttle tests against a yet-unimplemented module

**What:** Create [src/lib/auth/__tests__/throttle.test.ts](src/lib/auth/__tests__/throttle.test.ts) covering every case in §8 of the spec. The implementation file may not exist yet — the tests should `import` from the path that will exist after Task 3 and fail with a clean module-not-found.

**Files:**
- `src/lib/auth/__tests__/throttle.test.ts` — full test suite

**Test cases (each as `it(...)`):**

Window semantics (using `isMagicLinkRateLimited`):
1. First request returns `false` and inserts a row
2. 5th request returns `false`, 6th returns `true`
3. 6th request inside window does NOT insert a row (table stays at 5)
4. A row older than `WINDOW_MS` is treated as expired (doesn't count toward limit)
5. Old rows are deleted on the next call for that key

Case sensitivity:
6. "Foo@Example.com" and "foo@example.com" share the same counter

Generic helper (`isKeyRateLimited`):
7. Generic helper enforces its own `{ maxRequests, windowMs }`
8. Two different generic keys do not share counters

Time injection:
9. All tests pass an explicit `now: Date` via `deps` so they're deterministic. The module supports `now?: Date` and falls back to `new Date()`.

**Acceptance:**
- All tests fail with the right shape of error (module not found OR function not yet implemented). No false positives.
- `npm test src/lib/auth` reports the expected failures.

**Commit:** `test(throttle): add failing tests for persistent rate limiter`

---

## Task 3 — Implement `src/lib/auth/throttle.ts`

**What:** Create the module per §3b/§3c of the spec. Two exports: `isMagicLinkRateLimited` and `isKeyRateLimited`. SERIALIZABLE transaction with one-time retry; fail-closed on second conflict.

**Files:**
- `src/lib/auth/throttle.ts` — implementation

**Implementation notes:**
- Use the same `Db` type alias pattern as [src/lib/posts/repository.ts](src/lib/posts/repository.ts) and [src/lib/alerts/check-stale-posts.ts](src/lib/alerts/check-stale-posts.ts). The handoff flagged this as triplicated — **do not extract a shared type as part of this task**; that's a separate follow-up. Keep the local copy for now.
- `now = deps.now ?? new Date()`
- `windowStart = new Date(now.getTime() - MAGIC_LINK_WINDOW_MS)` (or the parameterized window for the generic helper)
- Transaction body: `DELETE` expired rows for this key → `SELECT count(*)` for this key → if `>= max` skip insert, else `INSERT`. Return the boolean.
- Catch a serialization-failure error code (Postgres `40001`); retry once. On second failure, return `true`.
- On Neon's serverless driver, use `db.transaction(async (tx) => {...}, { isolationLevel: "serializable" })`. If that overload doesn't exist on the type, fall back to `db.execute(sql\`BEGIN ISOLATION LEVEL SERIALIZABLE\`)`-style — but try the typed path first.

**Acceptance:**
- All tests from Task 2 pass
- `npx tsc --noEmit` green
- No new ESLint warnings
- The module has zero `any` casts (per `~/.claude/rules/typescript/coding-style.md`)

**Commit:** `feat(throttle): implement persistent magic-link rate limiter`

---

## Task 4 — Wire the new throttle into `src/lib/auth.ts`

**What:** Replace the `isRateLimited` import + call in [src/lib/auth.ts](src/lib/auth.ts) with `isMagicLinkRateLimited` + `await`.

**Files:**
- [src/lib/auth.ts](src/lib/auth.ts) — single import line + single call site swap

**Acceptance:**
- The function is awaited (sendVerificationRequest is already async)
- `npx tsc --noEmit` green
- All tests still pass

**Commit:** `feat(auth): use persistent throttle for magic-link sends`

---

## Task 5 — Delete the in-memory module

**What:** Remove [src/lib/rate-limit.ts](src/lib/rate-limit.ts) and any test file for it. Grep for `isKeyRateLimited` and `isRateLimited` from `rate-limit` — confirm only the deleted file referenced them.

**Files:**
- Delete `src/lib/rate-limit.ts`
- Delete any associated test file (if exists)

**Acceptance:**
- `git grep "from.*rate-limit"` returns nothing
- `npx tsc --noEmit` green
- All tests pass
- Build succeeds: `npm run build`

**Commit:** `refactor(auth): remove obsolete in-memory rate limiter`

---

## Task 6 — Run the migration locally (via `npm run db:migrate`)

**What:** Apply the migration against the Neon dev database. Verify the table and index exist.

**Files:** None modified.

**Acceptance:**
- `npm run db:migrate` exits 0
- Drizzle Studio (or psql) confirms `auth_throttle` table exists with the expected columns and index
- No data loss in existing tables

**Commit:** None (DB-only action). Note the result in the morning handoff doc.

---

## Task 7 — Push branch + draft PR body

**What:** Push `feat/rate-limit-persistence` to `origin`. Write `.pr-body-rate-limit.md` at the repo root with the PR description (since `gh` CLI is not installed locally, the human opens the PR via web UI).

**Files:**
- `.pr-body-rate-limit.md` — PR description draft

**PR body structure:**
- Summary (one paragraph)
- Why (cross-instance correctness, restart durability)
- Approach (table + sliding-window log + SERIALIZABLE)
- Test coverage summary
- Manual smoke checklist for the human
- Notes / follow-ups

**Acceptance:**
- Branch pushed to `origin/feat/rate-limit-persistence`
- `.pr-body-rate-limit.md` exists and is comprehensive

**Commit:** `docs: PR body draft for rate-limit-persistence`

---

## Two-stage review per task

For each task above, before moving on:

1. **Spec compliance:** does the diff match what §X of the spec called for? Anything missing or extra?
2. **Code quality:** small functions, named constants, no `any`, no swallowed errors, no orphaned files, no comments that explain WHAT (per CLAUDE.md style rules).

If a follow-up surfaces (e.g. the `Db` type alias triplication), capture it at the bottom of the morning handoff doc rather than expanding scope mid-branch.

---

## Follow-ups intentionally not in this plan

- Extracting the `Db` type alias to a shared file (`src/db/types.ts`). Per the handoff, do this as a separate refactor once this branch lands.
- Switching to Upstash Redis for the rate limiter — paid dependency, deferred.
- IP-based throttling layer — orthogonal feature, separate spec.
