# GDPR Export + Deletion — Design

**Date:** 2026-05-12
**Feature:** Client-facing data export and account-deletion request flow with a 24-hour cooling-off period (Part A improvement #4)
**Status:** Design complete, ready for implementation plan

## 1. What we're building

A two-button "Account & Privacy" surface in the client dashboard that gives clients GDPR-equivalent rights:

1. **Export my data** — one click downloads a JSON file containing everything the system stores about the client.
2. **Delete my account** — one click schedules deletion for 24 hours from now, sends a confirmation email with a cancel link, and a cron job performs the actual deletion when the timer expires. The deletion sweep removes Vercel Blob files (photos), then cascades through DB rows via existing FK constraints. The `deletionAuditLog` row is written before deletion.

The flow is client-initiated and self-service. Stefan does not need to act for either path. Stefan's admin "delete user" endpoint at [src/app/api/admin/delete-user/route.ts](src/app/api/admin/delete-user/route.ts) remains as an emergency / support tool, unchanged.

This is a launch blocker per [CLAUDE.md](CLAUDE.md) §11 ("GDPR compliance is a launch blocker, not a building blocker") — but it's also the *floor*, not the ceiling. The design errs toward simplicity over feature richness, with the explicit understanding that fancier features (e.g. per-data-category export, partial deletion, account-merge) are out of scope.

## 2. Why these specific choices

| Decision | Choice made | Alternatives considered |
|---|---|---|
| Format | JSON, one file, schema-versioned | CSV (data is nested — flattening loses structure); ZIP with separate files (more code for marginal benefit); PDF (unreasonable) |
| Photos in export | URLs only, not bytes | Inline base64 (huge files, slow); separate ZIP with binaries (cron-bombs the function, blocks the download for minutes). URLs are already public Blob URLs the user can curl. |
| Deletion confirmation | Email with cancel link (token-protected) | Email with confirm link (extra step before scheduling); SMS (no Twilio); in-app confirmation only (lost if user closes the tab) |
| Cooling-off duration | 24 hours, configurable via constant | Immediate (no rescue from misclicks); 7 days (too long — irritating). CLAUDE.md hints at 24h. |
| Deletion mechanism | Hourly cron sweeps `deletionRequests` for expired-but-uncancelled rows | Inline at-request-time setTimeout (lost on cold start); deferred queue / Vercel Queues (paid beta, overkill) |
| Cancel mechanism | Token in URL → GET endpoint that stamps `cancelledAt` | Logged-in cancel link (forces re-auth via magic link, friction); email reply with magic word (parsing fragility) |
| Blob deletion | Best-effort: try to delete each photo's Blob URL, log failures, never block the DB delete | Skip Blob deletion (orphans + paid storage growth); fail the whole deletion if any blob delete fails (one transient Vercel Blob outage permanently breaks the deletion path) |
| Cron schedule | Hourly, same cadence as existing `/api/cron/check-alerts` | More frequent (no point — the 24h timer dwarfs cron granularity); daily (24h promise becomes "up to 48h", confusing) |
| Cron endpoint location | New route `/api/cron/process-deletions` | Bolt onto existing `check-alerts` route (couples unrelated concerns; complicates per-pass error isolation) |
| Pending deletion visibility | Banner on dashboard showing "Account scheduled for deletion at X. [Cancel]" | Email-only (user may not see it if they don't check email) |
| Audit log scope | Existing `deletionAuditLog` table is sufficient | New separate table for client-initiated vs admin-initiated (`deletedBy` field already disambiguates) |

The decision to schedule via a `deletionRequests` row plus a cron sweep (rather than a long-running task or an inline setTimeout) is the only structurally important choice. Everything else is policy.

## 3. Architecture

### 3a. New table

```ts
// src/db/schema.ts addition
export const deletionRequests = pgTable("deletion_requests", {
  id: text("id")
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .unique() // one active request per user
    .references(() => users.id, { onDelete: "cascade" }),
  cancelToken: text("cancelToken").notNull().unique(),
  requestedAt: timestamp("requestedAt", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
  scheduledFor: timestamp("scheduledFor", { withTimezone: true, mode: "date" })
    .notNull(),
  cancelledAt: timestamp("cancelledAt", { withTimezone: true, mode: "date" }),
  completedAt: timestamp("completedAt", { withTimezone: true, mode: "date" }),
})
```

The `userId` unique constraint enforces "one active request per user." If the user clicks "Delete" again while a request exists, the API surfaces the existing request rather than creating a duplicate. The `cancelToken` is a UUID generated server-side and embedded in the cancel-link URL; it's a single field rather than a hash because a stolen cancel link is only useful to *not delete* the user — there's no escalation path.

`onDelete: "cascade"` on `userId` ensures that when the user is actually deleted, the request row goes with them — no orphan rows.

### 3b. Two new server actions

In `src/app/dashboard/account/actions.ts`:

```ts
"use server"

export async function exportMyDataAction(): Promise<{
  success: true
  jsonBlob: string
  filename: string
} | {
  success: false
  error: string
}>

export async function requestAccountDeletionAction(): Promise<{
  success: true
  scheduledFor: string  // ISO timestamp
} | {
  success: false
  error: string
}>

export async function cancelAccountDeletionAction(): Promise<{
  success: true
} | {
  success: false
  error: string
}>
```

All three call `auth()` first and reject anonymous callers with a generic error.

### 3c. One new public GET route (for the email cancel link)

`GET /api/account/deletion/cancel?token=<uuid>`

- No auth required — the token itself is the proof. (The user might be logged out when clicking the link in their inbox.)
- Looks up the row by `cancelToken`. If found and `cancelledAt IS NULL` and `completedAt IS NULL`, stamps `cancelledAt = now()`.
- Renders a confirmation page (`/account/deletion/cancelled`) with friendly Dutch copy.
- If token not found or row is already cancelled/completed: renders a generic "this link is no longer valid" page. **Does not** reveal whether the token ever existed (prevents token-existence enumeration).

### 3d. One new cron route

`GET /api/cron/process-deletions`

- `CRON_SECRET` bearer check, identical to `/api/cron/check-alerts`.
- Query: `SELECT * FROM deletion_requests WHERE cancelledAt IS NULL AND completedAt IS NULL AND scheduledFor <= now()`.
- For each match: run the deletion logic (see §3e), stamp `completedAt`. Per-row try/catch — one failure does not block the rest.
- Return `{ processed: N, failed: M }`.
- Add to `vercel.json`: `{ "path": "/api/cron/process-deletions", "schedule": "0 * * * *" }`.

### 3e. Deletion logic (the actual hard work)

A core module `src/lib/account/delete.ts`:

```ts
export async function deleteUserAccount(
  db: Db,
  userId: string,
  deletedBy: string,
  deps: { deleteBlob: (url: string) => Promise<void> }
): Promise<{ deletedPhotoCount: number; failedBlobCount: number }>
```

Steps, in order:

1. Read the user row (need email for the audit log).
2. Read all photos for the user's client(s). Collect `blobUrl` values.
3. Write the `deletionAuditLog` row **BEFORE** deleting the user (so audit survives even if step 5 partially fails).
4. Attempt to delete each photo's Blob via `deps.deleteBlob(url)`. Catch per-URL errors; increment `failedBlobCount`; `console.error` with context. Do not abort the loop. The DB cascade in the next step will still proceed.
5. Delete the user row. FK `onDelete: cascade` propagates through `clients`, `photos`, `posts`, `accounts`, `sessions`, `verificationTokens`, `deletionRequests`. The `deletionAuditLog` row is independent (no FK) and persists.

Note: the existing admin `/api/admin/delete-user` route should be refactored to call this same `deleteUserAccount` function, so admin-initiated and client-initiated deletions share blob-cleanup behavior. This is a small enough side improvement to bundle. (See Task 7 in the plan.)

### 3f. UI surface

New page `/dashboard/account` rendered as a server component:

- Section: "Mijn gegevens exporteren"
  - Button: "Download mijn gegevens" → triggers a Server Action that returns the JSON; client-side code creates a Blob URL and `<a download>` clicks it.
- Section: "Mijn account verwijderen"
  - If no pending request: button "Account verwijderen" → confirms via `<dialog>` modal ("Weet je het zeker? Je hebt 24 uur om te annuleren.") → calls the action.
  - If pending request: red banner "Je account wordt verwijderd op [datetime]. [Annuleren]". Annuleren calls the cancel action.
- Section: "Wat slaan we van je op?" — brief Dutch summary of categories: businessprofiel, geüploade foto's, gegenereerde posts en hun status, inlog-events.

The banner about a pending deletion should ALSO appear at the top of the main dashboard page so it's visible without navigating to settings.

Visual treatment: Dutch, friendly, sober. This is not a hero page — it's a compliance form. No bento layout, no animations. The existing dashboard's typography and color tokens apply.

## 4. Data model changes

### New table

| Column | Type | Default | Purpose |
|---|---|---|---|
| `id` | `text`, PK | UUID | Row identity |
| `userId` | `text`, not null, UNIQUE | — | Owner; cascades on user delete |
| `cancelToken` | `text`, not null, UNIQUE | — | UUID embedded in email cancel link |
| `requestedAt` | `timestamp(tz)`, not null | `now()` | When the user clicked "Delete" |
| `scheduledFor` | `timestamp(tz)`, not null | — | `requestedAt + 24h`, set explicitly |
| `cancelledAt` | `timestamp(tz)`, nullable | NULL | Stamped when the user (or admin) cancels |
| `completedAt` | `timestamp(tz)`, nullable | NULL | Stamped by the cron after successful deletion |

### Existing table reuse

`deletionAuditLog` is unchanged. The existing columns (`deletedUserEmail`, `deletedUserId`, `deletedBy`, `deletedAt`) cover everything we need. For client-initiated deletions, `deletedBy = userId` (the user deleted themselves).

### Index

```sql
CREATE INDEX deletion_requests_due_idx
  ON deletion_requests (scheduledFor)
  WHERE cancelledAt IS NULL AND completedAt IS NULL;
```

Partial index — the cron query is the only hot read, and only ever for un-cancelled un-completed rows. Drizzle's `pg-core` supports `.where(sql\`...\`)` on indexes; we'll use the literal form.

## 5. Export JSON shape

```jsonc
{
  "schemaVersion": 1,
  "exportedAt": "2026-05-12T10:00:00Z",
  "user": {
    "id": "uuid",
    "email": "client@example.com",
    "name": "...",
    "role": "client",
    "createdAt": "2026-..."
  },
  "client": {
    "id": "uuid",
    "businessName": "...",
    "location": "...",
    "industry": "...",
    "businessType": "...",
    "productsServices": "...",
    "logoUrl": "...",
    "createdAt": "...",
    "updatedAt": "..."
  },
  "photos": [
    {
      "id": "uuid",
      "blobUrl": "https://...",
      "originalFilename": "kebab.jpg",
      "mimeType": "image/jpeg",
      "sizeBytes": 123456,
      "analysis": { ... },
      "analyzedAt": "...",
      "createdAt": "..."
    }
  ],
  "posts": [
    {
      "id": "uuid",
      "platform": "instagram",
      "scheduledDate": "2026-05-13",
      "status": "approved",
      "content": "...",
      "photoId": "uuid",
      "reasoning": "...",
      "publishAt": "...",
      "rejectionCount": 0,
      "approvedAt": "...",
      "rejectedAt": null,
      "publishedAt": null,
      "publishError": null,
      "firstSeenAt": "...",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "deletionRequest": null
}
```

Notes:
- `accounts`, `sessions`, and `verificationTokens` are NOT included — they are auth-mechanism artifacts, not user data, and contain hashed tokens that should not leak.
- Photo Blob URLs are included as-is; they are already publicly accessible (the Blob URLs are unguessable but unauthenticated). If we ever migrate to private Blob storage, this becomes a real concern, but at v1 it's a non-issue.
- The `analysis` JSON is included verbatim because it is user-derived data (their photos analyzed by Claude on their behalf).
- `schemaVersion: 1` allows future format changes without breaking parsers.

Filename: `social-ai-export-${clientId}-${YYYY-MM-DD}.json`.

## 6. Email content

### Subject

`Bevestiging: je account wordt over 24 uur verwijderd`

### Body card

Dutch, friendly, warm — per [CLAUDE.md](CLAUDE.md) §10 ("Never write Dutch communication in formal/corporate tone").

> Hallo!
>
> Je hebt zojuist gevraagd om je Postje-account te verwijderen. We wachten 24 uur voordat we dit definitief doen — zodat je tijd hebt om je te bedenken.
>
> **Je account wordt verwijderd op [datetime in Europe/Amsterdam].**
>
> Wil je dit toch niet? Klik op de knop hieronder, dan annuleren we het verzoek meteen.
>
> [ANNULEER VERWIJDERING] ← button → `${appUrl}/api/account/deletion/cancel?token=...`
>
> Heb je vragen? Stuur een mailtje naar stefan@... (zolang je nog kunt!).

Final wording lives in the implementation, not this spec. The composer HTML-escapes any interpolated values.

## 7. Error handling

| Failure mode | Behavior |
|---|---|
| Export: user has no `clients` row (admin or new user) | Return `{ success: false, error: "Geen klantprofiel gevonden" }` — admin users export via a separate flow (not in scope for v1) |
| Export: DB read fails | Throw — generic 500 to the user; logged with stack |
| Deletion request: row already exists for this user | Return `{ success: true, scheduledFor: <existing> }` — idempotent. The action UI shows the existing banner. |
| Deletion request: email send fails | Insert the row anyway; log the email failure. Reason: the deletion is now real (24h timer started); the cron will execute it. We'd rather have an extra accidental deletion the user couldn't cancel via email (they can still cancel in-app) than a deletion that vanishes silently. The banner in-app surfaces the pending request. |
| Cancel link: token not found | Generic "this link is no longer valid" page. No 404 (information leak). |
| Cancel link: token matches a completed/cancelled row | Same generic page. |
| Cron: deletion logic throws | Per-row try/catch; failed row is left with `completedAt = NULL` and will retry on the next cron run. After 5 retries (i.e. failed for 5+ hours), the cron logs an `[ALERT]` line for Stefan to investigate manually. No automatic escalation in v1. |
| Cron: Vercel Blob delete fails | Logged per URL; the DB delete still proceeds (FK cascade handles posts/photos); the `failedBlobCount` is included in the deletion's log line so it's visible in Vercel logs. |
| Cron: user is already gone (race with admin delete) | The query returns no row; the deletion silently no-ops. |

## 8. Files to create or modify

### New files

| Path | Purpose |
|---|---|
| `src/db/migrations/NNNN_add_deletion_requests.sql` | Auto-generated migration |
| `src/lib/account/delete.ts` | Core delete-user-and-blobs logic, callable from both client + admin flows |
| `src/lib/account/export.ts` | Build the export JSON for a given client |
| `src/lib/account/deletion-request.ts` | Repository: create/get/cancel deletion request + token generation |
| `src/lib/account/deletion-email.ts` | Compose + send the 24h cancellation email via Resend |
| `src/lib/account/__tests__/delete.test.ts` | Unit tests for `deleteUserAccount` |
| `src/lib/account/__tests__/export.test.ts` | Unit tests for `buildExportJson` |
| `src/lib/account/__tests__/deletion-request.test.ts` | Repository tests |
| `src/app/dashboard/account/page.tsx` | Account & Privacy server component |
| `src/app/dashboard/account/actions.ts` | The three server actions |
| `src/components/dashboard/pending-deletion-banner.tsx` | Reused on `/dashboard` and `/dashboard/account` |
| `src/app/api/account/deletion/cancel/route.ts` | Public GET endpoint for the email cancel link |
| `src/app/account/deletion/cancelled/page.tsx` | Friendly post-cancellation confirmation page |
| `src/app/api/cron/process-deletions/route.ts` | The hourly cron sweep |

### Modified files

| Path | Change |
|---|---|
| `src/db/schema.ts` | Add `deletionRequests` table |
| `src/app/api/admin/delete-user/route.ts` | Refactor to call `deleteUserAccount` (shared logic) |
| `src/app/dashboard/page.tsx` | Mount `<PendingDeletionBanner>` at the top |
| `vercel.json` | Add the new cron entry |

### No deletions

The existing `deletionAuditLog` table and admin endpoint stay.

## 9. Constants

```ts
const DELETION_COOLING_OFF_HOURS = 24
const DELETION_COOLING_OFF_MS = DELETION_COOLING_OFF_HOURS * 60 * 60 * 1000
const EXPORT_SCHEMA_VERSION = 1
```

These live next to behavior, not in a project-wide constants file.

## 10. Testing strategy

### Unit tests (Vitest + PGlite)

`export.test.ts`:
- Includes the user, client, photos, posts; structure matches `EXPORT_SCHEMA_VERSION` shape
- Photo URLs included; analysis JSON preserved
- Accounts / sessions / verification tokens NOT included
- A user with multiple clients exports correctly (edge case — current schema enforces `clients.userId` UNIQUE so this can't happen, but the export should still handle the array shape gracefully)
- A user with a pending `deletionRequest` includes that row's public fields (NOT the cancel token)

`deletion-request.test.ts`:
- Creating a request inserts a row with `scheduledFor = requestedAt + 24h`
- Creating a request for a user that already has an active request returns the existing row (idempotent)
- Creating a request for a user whose request is cancelled creates a NEW row
- Cancelling stamps `cancelledAt`
- A cancelled request can be re-issued (creates a new row with new token)
- Cancel-by-token returns success for a fresh token, generic failure for an unknown/used token

`delete.test.ts`:
- Deletes a user with no photos: writes audit log, no blob calls, FK cascade clears clients
- Deletes a user with 3 photos: calls `deps.deleteBlob` 3 times with the right URLs
- A blob delete failure is logged and counted, but does not abort
- After deletion, `users` row is gone; `clients`, `photos`, `posts` cascade-deleted; `deletionAuditLog` row remains

### Server-action tests (Vitest)

`actions.test.ts`:
- `exportMyDataAction` returns a JSON blob scoped to the caller's `clientId`; calling as a different user returns only that user's data (tenant isolation)
- `requestAccountDeletionAction` creates a row and triggers `sendDeletionEmail`; if email send fails, the row is still there
- `cancelAccountDeletionAction` is a no-op if no active request exists

### Cron-route tests

`process-deletions.test.ts`:
- Returns 401 without `CRON_SECRET` header
- With no eligible requests: returns 200 with `{ processed: 0, failed: 0 }`
- With one eligible request: invokes `deleteUserAccount`, stamps `completedAt`
- With one cancelled request that is also due: skipped
- With one due request that fails: leaves `completedAt` NULL, increments `failed`

### Manual integration test (dev)

1. Sign in as a test client. Upload 2 photos. Generate some posts. Approve one.
2. Go to `/dashboard/account`. Click "Download mijn gegevens". Confirm: JSON file downloads, contains all data, no auth artifacts.
3. Click "Account verwijderen". Confirm modal. Click confirm. Banner appears: "Je account wordt verwijderd op [time]". Email arrives in Resend test inbox.
4. Click the cancel link in the email (or use the in-app "Annuleren" button). Banner disappears. `deletion_requests` row has `cancelledAt` stamped.
5. Re-request deletion. Wait until `scheduledFor` is in the past (or `UPDATE deletion_requests SET scheduledFor = now() - interval '1 hour'`). Call `GET /api/cron/process-deletions` with the CRON_SECRET. Confirm: user, clients, photos, posts all gone; `deletionAuditLog` row exists; Vercel Blob files removed (check `vercel blob ls` after deploy or the dashboard).

## 11. Environment variables

- **`AUTH_RESEND_KEY`** — already set, reused for the deletion-confirmation email.
- **`EMAIL_FROM`** — already set.
- **`CRON_SECRET`** — already set; gates the new `/api/cron/process-deletions` endpoint.
- **`NEXT_PUBLIC_APP_URL`** — already used by stale-post / regen-limit alert emails for admin links; reused here for the cancel-link absolute URL.

No new variables.

## 12. Explicitly out of scope

- **Partial deletion / per-data-category deletion.** GDPR allows users to request deletion of specific categories. V1 is all-or-nothing — much simpler, covers 95% of requests, and the user can always re-sign up if they want a fresh start.
- **Re-confirmation flow.** Some services require a magic-link click *before* scheduling deletion. This adds friction for legitimate users while not meaningfully harming an attacker (who already has the user's session). V1 trusts the logged-in session.
- **Email confirmation of completed deletion.** Once the cron deletes the account, no follow-up email is sent — the user is gone. If they wanted confirmation, the cancel-link email already states that no further action is needed.
- **Cancel-after-completion grace period.** Once `completedAt` is stamped, the data is gone. No recovery, no 30-day backup retrieval. CLAUDE.md `Definition of Done` would be violated by a hidden retention mechanism.
- **Admin-side view of pending deletion requests.** Stefan can SQL-query if needed. A dedicated UI is the Attention List (Part A improvement #3).
- **Bulk export for Stefan as admin.** Stefan exports a single client's data by signing in as them (admin impersonation) — not in scope and not currently supported. If needed, Stefan SQL-queries.
- **Account-merge / data-portability-import.** Importing data from another social-AI tool is out of scope and probably never coming.
- **Two-factor on the delete action.** No 2FA infrastructure exists. The 24h cooling-off is the safety net.
- **Email translation to user's preferred language.** All UX is Dutch. If the project ever supports English, the email composer takes a `locale` arg.

## 13. Open questions for implementation

- **Server Action return type for a binary download.** The cleanest pattern is for the action to return the JSON string and the client component creates a Blob URL. The alternative — a Next.js Route Handler that streams the response — works but couples the export to a URL we have to lock down. We go with the Server-Action-returns-string path; locking is implicit in the Server Action's auth check.
- **Whether to email Stefan when a client requests deletion.** Useful for Stefan-as-operator. Defer to implementation — if it's a 5-line `console.error` or `await sendAdminAlert(...)`, do it; otherwise skip and capture as a follow-up.
- **Partial-index syntax in Drizzle.** `pg-core` exposes `.where(sql\`...\`)` on the `index()` builder. If this proves to not exist on the installed Drizzle version, ship without the partial index (the cron query still works, just scans slightly more rows — negligible at v1 scale).
- **Whether to include `accounts.providerAccountId` in the export.** It's a Resend-internal account ID; arguably user-derived data. Conservative call: exclude — it's an auth artifact, not user data. Re-evaluate if a user ever explicitly requests it.
