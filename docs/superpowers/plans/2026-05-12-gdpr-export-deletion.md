# GDPR Export + Deletion — Implementation Plan

**Spec:** [docs/superpowers/specs/2026-05-12-gdpr-export-deletion-design.md](../specs/2026-05-12-gdpr-export-deletion-design.md)
**Branch:** `feat/gdpr-export-deletion`
**Date:** 2026-05-12

Bite-sized TDD tasks. One commit per task. Two-stage review (spec compliance + code quality) per task.

---

## Task 1 — Add `deletionRequests` table

**What:** Add the table to [src/db/schema.ts](src/db/schema.ts). Generate migration.

**Files:**
- `src/db/schema.ts` — add `deletionRequests` table
- `src/db/migrations/NNNN_add_deletion_requests.sql` — auto-generated

**Acceptance:**
- `npx tsc --noEmit` green
- `npm run db:generate` produces one new migration with `CREATE TABLE "deletion_requests"`, unique constraints on `userId` and `cancelToken`, and the partial index (or non-partial if the syntax isn't available)
- 125 existing tests still pass

**Commit:** `feat(db): add deletion_requests table for GDPR delete-account flow`

---

## Task 2 — Implement export module (`src/lib/account/export.ts`)

**What:** A pure function `buildExportJson(db, userId)` that gathers user/client/photos/posts/deletionRequest into the schema-versioned JSON shape. Write tests first.

**Files:**
- `src/lib/account/__tests__/export.test.ts` — failing tests for shape, scope, exclusions
- `src/lib/account/export.ts` — implementation

**Test cases:**
- Returns the JSON shape from §5 of the spec with `schemaVersion: 1`
- Scoped to the given `userId` only (insert two users; export of A excludes B's data)
- Includes user, client, photos[], posts[]
- Excludes accounts, sessions, verificationTokens
- `deletionRequest: null` when no active request; populated when one exists
- Pending deletion in export does NOT leak `cancelToken`

**Acceptance:**
- All test cases pass
- Function is pure (no `console`, no email, no side effects)

**Commit:** `feat(account): implement data export builder`

---

## Task 3 — Implement deletion-request repository (`src/lib/account/deletion-request.ts`)

**What:** Repository for creating, fetching, cancelling deletion requests.

**Files:**
- `src/lib/account/__tests__/deletion-request.test.ts` — failing tests
- `src/lib/account/deletion-request.ts` — implementation

**Public functions:**

```ts
export function generateCancelToken(): string  // crypto.randomUUID

export async function createOrGetDeletionRequest(
  db: Db,
  userId: string,
  now: Date
): Promise<DeletionRequest>

export async function getActiveDeletionRequest(
  db: Db,
  userId: string
): Promise<DeletionRequest | null>

export async function cancelDeletionRequestByToken(
  db: Db,
  token: string,
  now: Date
): Promise<{ cancelled: boolean }>

export async function cancelDeletionRequestForUser(
  db: Db,
  userId: string,
  now: Date
): Promise<{ cancelled: boolean }>

export async function findDueDeletionRequests(
  db: Db,
  now: Date
): Promise<DeletionRequest[]>

export async function markDeletionCompleted(
  db: Db,
  requestId: string,
  now: Date
): Promise<void>
```

**Test cases:** Each one matches the spec's testing strategy §10.

**Acceptance:**
- All test cases pass
- No leaks of the cancel token from any reader function (the export-shape test in Task 2 already covers this from the caller side; this task's tests verify the repository returns the full row, which is fine for internal callers)

**Commit:** `feat(account): implement deletion-request repository`

---

## Task 4 — Implement core deletion logic (`src/lib/account/delete.ts`)

**What:** The `deleteUserAccount` function described in §3e of the spec. Takes an injected `deleteBlob` dep so tests can run without hitting Vercel Blob.

**Files:**
- `src/lib/account/__tests__/delete.test.ts` — failing tests
- `src/lib/account/delete.ts` — implementation

**Signature:**

```ts
export interface DeleteUserDeps {
  deleteBlob: (url: string) => Promise<void>
}

export async function deleteUserAccount(
  db: Db,
  userId: string,
  deletedBy: string,
  deps: DeleteUserDeps,
  now?: Date
): Promise<{ deletedPhotoCount: number; failedBlobCount: number }>
```

**Test cases** match §10 unit tests for `delete.test.ts`.

**Acceptance:**
- The function writes audit log BEFORE the user delete
- A failing `deleteBlob` does not abort the deletion
- All FK cascades work via PGlite

**Commit:** `feat(account): implement core deleteUserAccount`

---

## Task 5 — Implement the email composer (`src/lib/account/deletion-email.ts`)

**What:** Builds and sends the Dutch confirmation email. HTML-escape user-controlled fields.

**Files:**
- `src/lib/account/__tests__/deletion-email.test.ts` — composer tests
- `src/lib/account/deletion-email.ts` — composer + send

**Public interface:**

```ts
export interface SendDeletionEmailArgs {
  to: string
  scheduledFor: Date
  cancelToken: string
  appUrl: string
}

export async function sendDeletionEmail(
  args: SendDeletionEmailArgs
): Promise<{ success: true } | { success: false; error: string }>
```

**Test cases:**
- Subject mentions "Bevestiging" and "24 uur"
- HTML escapes the email field if it contains special characters (defensive — emails are validated upstream but no harm)
- Cancel URL is correctly built as `${appUrl}/api/account/deletion/cancel?token=${cancelToken}`
- Returns `{ success: false, error: ... }` when `AUTH_RESEND_KEY` is missing
- Scheduled time is formatted in Europe/Amsterdam (the user's locale)

**Acceptance:**
- All test cases pass
- The composer is pure (separable from the Resend network call) so the tests can assert on the HTML directly

**Commit:** `feat(account): implement deletion confirmation email`

---

## Task 6 — Implement the cron route + pending-deletion sweep

**What:** New `/api/cron/process-deletions` route.

**Files:**
- `src/app/api/cron/process-deletions/route.ts` — handler
- `src/app/api/cron/process-deletions/__tests__/route.test.ts` — route tests
- `vercel.json` — add cron entry

**Behavior:** Per §3d of the spec. Validates `CRON_SECRET`, queries `findDueDeletionRequests`, calls `deleteUserAccount` for each, stamps `completedAt`.

**Test cases:**
- 401 without correct `CRON_SECRET`
- 200 with `{ processed: 0, failed: 0 }` when nothing is due
- 200 with `{ processed: 1, failed: 0 }` after one row is processed
- One row that throws inside `deleteUserAccount` increments `failed`, does not block others
- Cancelled rows are skipped

**Acceptance:**
- Route tests pass
- `vercel.json` has the new cron entry

**Commit:** `feat(cron): add process-deletions hourly sweep`

---

## Task 7 — Refactor admin delete-user to share logic

**What:** [src/app/api/admin/delete-user/route.ts](src/app/api/admin/delete-user/route.ts) currently inlines its own deletion sequence. Refactor to call `deleteUserAccount`.

**Files:**
- `src/app/api/admin/delete-user/route.ts` — call shared logic; pass `deletedBy = session.user.id`

**Acceptance:**
- Existing behavior preserved
- Admin deletion now also cleans up Vercel Blob photos
- Existing tests for admin delete (if any — currently none in `__tests__`) still pass
- Manual smoke: from admin UI, deleting a test client also removes their blobs

**Commit:** `refactor(admin): share deleteUserAccount with client-initiated flow`

---

## Task 8 — Cancel link route + cancelled page

**What:** Public GET endpoint and the friendly Dutch confirmation page.

**Files:**
- `src/app/api/account/deletion/cancel/route.ts` — token lookup + stamp
- `src/app/account/deletion/cancelled/page.tsx` — server component, no client JS
- `src/app/api/account/deletion/cancel/__tests__/route.test.ts` — route tests

**Test cases:**
- Valid token: stamps `cancelledAt`, redirects to `/account/deletion/cancelled`
- Invalid token: generic "no longer valid" response (no information leak)
- Already-cancelled token: same generic response
- Missing `token` query param: generic response

**Acceptance:**
- The route never reveals whether a token existed
- A cancelled deletion-request row has `cancelledAt` stamped after the request

**Commit:** `feat(account): public cancel-link endpoint for deletion email`

---

## Task 9 — Server actions for the dashboard UI

**What:** Three Server Actions per §3b of the spec.

**Files:**
- `src/app/dashboard/account/actions.ts` — three actions
- `src/app/dashboard/account/__tests__/actions.test.ts` — action tests with auth mocked

**Test cases (with `auth()` mocked):**
- `exportMyDataAction` requires auth; returns `{ success: false }` for unauthenticated callers
- `exportMyDataAction` scopes to the caller's `clientId` (tenant isolation)
- `requestAccountDeletionAction` is idempotent — second call returns the existing request
- `requestAccountDeletionAction` triggers email send (verify with mock)
- `cancelAccountDeletionAction` is a no-op when no active request

**Acceptance:**
- All test cases pass
- Actions reject unauthenticated callers consistently

**Commit:** `feat(account): server actions for export, request-delete, cancel`

---

## Task 10 — Dashboard "Account & Privacy" page + banner

**What:** New page `/dashboard/account` and a banner component shown on both `/dashboard` and `/dashboard/account` when a pending deletion exists.

**Files:**
- `src/app/dashboard/account/page.tsx` — server component layout
- `src/components/dashboard/pending-deletion-banner.tsx` — banner
- `src/components/dashboard/export-data-button.tsx` — client component that triggers download
- `src/components/dashboard/delete-account-button.tsx` — client component with confirm dialog
- `src/app/dashboard/page.tsx` — mount banner at top
- Update navigation if a dashboard nav exists

**UI requirements per spec §3f:**
- Dutch copy
- Sober compliance form, not a hero
- Banner is red (or attention-grabbing token), with a "Annuleren" inline action
- Confirm modal before triggering the delete action (uses `<dialog>` — no JS framework needed)

**Acceptance:**
- Manual smoke in browser: button works, modal works, banner shows after request, banner disappears after cancel
- No accessibility regressions (focus-visible, dialog keyboard support)

**Commit:** `feat(account): account & privacy dashboard page`

---

## Task 11 — Run migration locally + verify end-to-end

**What:** Apply the migration and walk through the manual integration test §10 of the spec.

**Acceptance:**
- `npm run db:migrate` exits 0
- Manual flow completes successfully on the dev branch
- All test suites green, build succeeds

**Commit:** None (verification only). Note in handoff.

---

## Task 12 — Push branch + draft PR body

**Files:**
- `.pr-body-gdpr-export-deletion.md` — PR description draft

**Acceptance:**
- Branch pushed
- PR body draft committed

**Commit:** `docs: PR body draft for gdpr-export-deletion`

---

## Migration-number conflict heads-up

This branch is based on `feat/postgres-migration`, the same base used by `feat/rate-limit-persistence`. Both branches will produce a migration numbered `0001_*.sql`. When the human merges both:

1. Merge `feat/rate-limit-persistence` first (already includes `0001_sharp_wolfpack.sql` for `auth_throttle`).
2. On the `feat/gdpr-export-deletion` branch, rebase onto the updated `main` and rename our migration from `0001_*.sql` to `0002_*.sql`. Update `src/db/migrations/meta/_journal.json` to reflect the new number. Regenerate `0002_snapshot.json` (or run `npm run db:generate` again, which should produce the right number once `0001` is in the schema history).
3. Push the rebased branch and re-merge.

The morning handoff doc captures this so the human doesn't get surprised.

---

## Follow-ups intentionally not in this plan

- Stefan email when a client requests deletion (mentioned in spec §13; defer if not trivial)
- Per-category export (out of scope)
- Account-merge / re-import (out of scope, possibly never)
- Two-factor on the delete action (no infra)
