# Regen-Limit Alerts — Design

**Date:** 2026-05-11
**Feature:** Email Stefan when a client has regenerated a single draft post 3 times (item 2 from the post-v1 priority list)
**Status:** Design complete, ready for implementation plan

## 1. What we're building

A cron-driven email alert that tells Stefan when a single draft post has been regenerated three times by its client. The trigger is `posts.rejectionCount` reaching `MAX_REJECTIONS` (currently 3). One alert per post, ever. Sent only during Dutch business hours (Mon–Fri 09:00–18:00 Europe/Amsterdam) — the same window used by stale-post alerts.

The alert is built on top of, and reuses, the cron + Resend pattern shipped in `2026-05-11-stale-post-alerts-design.md`. The existing endpoint `/api/cron/check-stale-posts` is renamed to `/api/cron/check-alerts` and becomes the single home for all post-state alerts. A second query runs alongside the stale-post query in the same handler.

The system does **not**:

- notify the client (they already see the Dutch "max bereikt — neem contact op met Stefan" message when they try a 4th regeneration)
- auto-retune the client profile
- escalate or re-alert
- persist past regeneration feedback
- reset the alert when Stefan retunes the profile (the post stays alerted forever; a new generated post starts fresh)

## 2. Why these specific choices

The non-obvious decisions, captured up front:

| Decision | Choice made | Alternative considered |
|---|---|---|
| Trigger semantic | Per-post: count hits 3 on a single draft | Per-client cumulative rejects; or both as two separate signals |
| Fire moment | After the 3rd successful regen (count transitions 2 → 3) | Only when the client is blocked on the 4th attempt — but then a silent giveup means Stefan never finds out |
| Send mechanism | Hourly cron, business-hours gated | Inline in `regeneratePostAction` (couples email send to UX, forces re-implementing the business-hours gate) |
| Endpoint layout | Rename existing endpoint to `/api/cron/check-alerts`, add the new query alongside stale-posts | New `/api/cron/check-regen-limits` endpoint (duplicates secret check, business-hours gate, Resend wrapper, and burns a Vercel Hobby cron slot) |
| Idempotency column | New `regenLimitAlertedAt`, separate from `alertedAt` | Reuse `alertedAt` — but then a post that hits both signals only fires once and the email body would be ambiguous |
| Email content | Standard pattern (client name + platform + date + post preview + admin link), with explanatory text suggesting profile retuning | Bare-bones email forcing a click; or rich email including feedback history (feedback isn't persisted today) |
| Index for the new query | No new index in v1 | Composite index — defer until scan time is measurable; posts at the regen ceiling are rare |

## 3. Architecture

Two changes to the existing cron, one new column.

### 3a. Endpoint rename

`/api/cron/check-stale-posts` → `/api/cron/check-alerts`.

The existing endpoint is one day old. Renaming now (rather than after a third alert type lands) keeps the URL honest. `vercel.json` is updated in the same change so the cron schedule continues uninterrupted.

### 3b. Second query inside the renamed endpoint

After the existing stale-posts pass, the handler runs:

```
SELECT posts.*, clients.businessName
FROM posts
INNER JOIN clients ON posts.clientId = clients.id
WHERE posts.status = 'draft'
  AND posts.rejectionCount >= 3
  AND posts.regenLimitAlertedAt IS NULL
```

For each match: send the email via Resend, then on success `UPDATE posts SET regenLimitAlertedAt = now() WHERE id = ?`. On send failure: log and skip — the next cron run retries.

The two passes (stale + regen-limit) are independent. A failure in one does not prevent the other from running.

### 3c. Endpoint behavior, step by step

The route is `GET /api/cron/check-alerts` — Vercel Cron sends GET with `Authorization: Bearer <CRON_SECRET>`.

1. Validate `CRON_SECRET` header. Missing or wrong → 401, empty body, no logs.
2. Run the stale-posts pass — unchanged core logic (`checkStalePosts`), still does its own business-hours check internally and returns `{ skipped, alertsSent, alertsFailed }`.
3. Run the regen-limit pass — new core logic module `checkRegenLimits`, same shape: own business-hours check, returns `{ skipped, alertsSent, alertsFailed }`.
4. Catch errors at the pass level. A throw inside one pass logs the error and reports `failed` for that pass; the other pass still runs.
5. Return 200 with the combined envelope:

```json
{
  "stale":      { "skipped": false, "alertsSent": N, "alertsFailed": M },
  "regenLimit": { "skipped": false, "alertsSent": N, "alertsFailed": M }
}
```

(Each sub-object includes `reason` when `skipped` is true — same shape as today's stale response.)

Cron schedule: still `0 * * * *` in `vercel.json`. Only the `path` changes.

## 4. Data model changes

### `posts` table addition

| Column | Type | Default | Purpose |
|---|---|---|---|
| `regenLimitAlertedAt` | `integer` (timestamp_ms), nullable | `NULL` | When Stefan was emailed about this post hitting the regen ceiling. `NULL` = not yet alerted. |

### Indexes

None added in v1. The new query is bounded by `rejectionCount >= 3`, which is rare in practice; sequential scan over the drafts subset is acceptable at current scale. Revisit if scan time becomes measurable in production.

### Migration handling for existing posts

Existing rows at deploy time have `regenLimitAlertedAt = NULL` (the new column's default). If any existing post already has `rejectionCount >= 3` at the moment this feature ships, the very next cron run during business hours will email Stefan about each one. This is the desired behavior — Stefan finds out about pre-existing stuck posts the day the feature goes live.

If for any reason a quiet backfill is preferred (e.g. to avoid a flood on launch day), Stefan can SQL-stamp `regenLimitAlertedAt = now()` on existing matches before deploy. Not part of this design's default path.

## 5. Files to create or modify

### New files

| Path | Purpose |
|---|---|
| `src/db/migrations/NNNN_add_regen_limit_alert.sql` | Adds the `regenLimitAlertedAt` column |
| `src/lib/alerts/regen-limit-email.ts` | Composes + sends the alert email via Resend (parallels `stale-post-email.ts`) |
| `src/lib/alerts/check-regen-limits.ts` | Core logic: business-hours gate, query, per-row send + stamp loop (parallels `check-stale-posts.ts`) |
| `src/lib/alerts/__tests__/regen-limit-email.test.ts` | Email composer tests |
| `src/lib/alerts/__tests__/check-regen-limits.test.ts` | Core logic tests with injected fake `sendEmail` |
| `src/app/api/cron/check-alerts/route.ts` | New endpoint — composes both passes |

### Modified files

| Path | Change |
|---|---|
| `src/db/schema.ts` | Add `regenLimitAlertedAt` column to the `posts` table |
| `src/lib/posts/repository.ts` | Add `findPostsAtRegenLimit(db)` and `markPostRegenLimitAlerted(db, postId, now?)` (mirroring `findStalePosts` / `markPostAlerted`) |
| `src/lib/posts/__tests__/repository.test.ts` | Tests for the two new repository functions |
| `vercel.json` | Update cron `path` from `/api/cron/check-stale-posts` to `/api/cron/check-alerts` |

### Deleted files

| Path | Reason |
|---|---|
| `src/app/api/cron/check-stale-posts/route.ts` (and its directory) | Replaced by `/api/cron/check-alerts`. Next.js App Router routing is directory-based, so the old folder must be removed to free the URL. |

### New repository function shape

```ts
export interface RegenLimitPost {
  id: string
  clientId: string
  businessName: string
  platform: "instagram" | "facebook"
  scheduledDate: string
  content: string
  rejectionCount: number
}

export function findPostsAtRegenLimit(db: Db): RegenLimitPost[]

export function markPostRegenLimitAlerted(
  db: Db,
  postId: string,
  now?: Date
): void
```

Kept separate from `StalePost` rather than unified. The two have different semantics, different fields (`firstSeenAt` vs `rejectionCount`), and different email bodies. If a third alert type lands later, that's the moment to extract a shared base interface — not now.

## 6. Email content

Dutch, friendly, follows the stale-post email visual pattern (same HTML layout, same button styling, same footer tone).

- **Subject:** `Klant heeft een post 3× laten herschrijven — ${businessName}`
- **Body card:** business name, platform (Instagram / Facebook), scheduled date, current post content (the 3rd regenerated version), button linking to `${appUrl}/admin/clients/${clientId}`.
- **Explanatory paragraph:** something close to *"Deze klant heeft een post drie keer laten herschrijven en is mogelijk niet tevreden met de huidige toon. Overweeg het klantprofiel bij te stellen."* — final wording lives in the implementation, not this spec.

The composer HTML-escapes the post content and business name before interpolating into the HTML body.

## 7. Error handling

| Failure mode | Behavior |
|---|---|
| Resend send fails (network, rate limit, etc.) | `console.error` with context. Do NOT stamp `regenLimitAlertedAt`. Next cron run retries the same post. |
| Thrown error inside the regen-limit pass (DB or other) | Route catches per-pass. Log the error. Response is still 200; the failing pass reports `alertsFailed` reflecting the unsent batch and the other pass runs to completion. Next scheduled hour retries. |
| Cron called without correct `CRON_SECRET` | 401, empty body, no log (avoid log spam from scanners) |
| Outside business hours | 200, `{ skipped: true, reason: "outside business hours" }`, single log line |
| Client lookup fails (orphan post — FK violation impossible due to `onDelete: cascade`, but defensive) | Log and skip that row, continue with the rest |
| Multiple posts match | Process sequentially. Per-row success/failure is independent. |

Idempotency is structural: the WHERE clause requires `regenLimitAlertedAt IS NULL`. Running the cron twice in close succession is harmless — no duplicate alerts.

## 8. Testing strategy

### Unit tests (Vitest)

`repository.test.ts` additions for `findPostsAtRegenLimit`:

- Returns posts where `status='draft'` AND `rejectionCount >= 3` AND `regenLimitAlertedAt IS NULL`
- Returns posts where `rejectionCount` is greater than 3 (e.g. `4`, `5` — defensive, even though the action blocks regen at ≥ 3)
- Excludes posts with `status` in `approved`, `rejected`, `published`, `failed`
- Excludes posts with `rejectionCount = 0`, `1`, or `2` (threshold respected)
- Excludes posts where `regenLimitAlertedAt` is already set (idempotency)
- Returns the joined `businessName` from the `clients` table

`repository.test.ts` additions for `markPostRegenLimitAlerted`:

- Sets `regenLimitAlertedAt` on a post where it was `NULL`
- Does NOT overwrite an existing `regenLimitAlertedAt` value (idempotent)
- No-op when the post ID does not exist

`regen-limit-email.test.ts`:

- Subject contains the escaped business name
- HTML escapes post content (e.g. injected `<script>` shows as `&lt;script&gt;`)
- HTML escapes business name
- Admin URL is correctly constructed as `${appUrl}/admin/clients/${clientId}`
- Returns `{ success: false, error: "..." }` when `AUTH_RESEND_KEY` is missing
- Returns `{ success: false, error: "..." }` when `ADMIN_EMAIL` is missing

### Core logic tests (Vitest, with injected fake `sendEmail`)

`check-regen-limits.test.ts`:

- Returns `{ skipped: true, reason: "outside business hours" }` when `now` is outside Mon–Fri 09:00–18:00 Amsterdam
- During business hours with no matching posts: returns `{ skipped: false, alertsSent: 0, alertsFailed: 0 }` and does not call `sendEmail`
- During business hours with N matching posts: calls `sendEmail` N times, stamps `regenLimitAlertedAt` N times, returns `alertsSent: N`
- When `sendEmail` returns `{ success: false, ... }`: does NOT stamp, increments `alertsFailed`, logs to stderr
- Mixed batch (some succeed, some fail): correct count split, only the successful rows are stamped

### Manual integration test (dev)

1. In dev, pick a draft post for a test client.
2. SQL: `UPDATE posts SET rejectionCount = 3 WHERE id = '<id>'`.
3. Send `GET /api/cron/check-alerts` with header `Authorization: Bearer <CRON_SECRET>` during NL business hours (or mock the clock in a test harness).
4. Confirm: Stefan's inbox receives the email; the row now has `regenLimitAlertedAt` stamped; response body shows `regenLimit.alertsSent === 1`.
5. Hit the endpoint again: response shows `regenLimit.alertsSent === 0`; no duplicate email.

### Production smoke test (post-deploy)

After deploying, in production: SQL-stamp `rejectionCount = 3` on one harmless test-client draft, wait for the next cron run during business hours, confirm the email arrives. Then clear the test post manually.

## 9. Environment variables

No new variables. The existing `CRON_SECRET`, `AUTH_RESEND_KEY`, `EMAIL_FROM`, and `ADMIN_EMAIL` are all reused.

## 10. Explicitly out of scope

- **Reset semantics.** Once `regenLimitAlertedAt` is stamped, the post is permanently alerted. If Stefan retunes the profile, the next *new* generated post starts at `rejectionCount = 0` naturally. Reusing the existing post and resetting its counter is not part of v1.
- **Client-facing notification.** The existing `regeneratePostAction` error message ("Je hebt het maximum aantal wijzigingen bereikt. Neem contact op met Stefan.") is the only client-side surfacing. No banner, no email, no dashboard indicator.
- **Aggregation / digest.** One email per post. If 5 posts from one client all hit the limit in the same day, Stefan gets 5 emails — same trade-off the stale alerts make (immediacy > batching).
- **Persisting regeneration feedback.** Today the per-regenerate `feedback` parameter is used inline and discarded. Showing the 3 feedback strings in the email would be valuable for Stefan but requires schema changes outside this feature's scope.
- **Per-client rolling cumulative limit.** A separate signal ("this client has rejected lots of posts overall") is item-for-the-future. This feature is strictly per-post.
- **Index for the new query.** Deferred. Sequential scan over drafts is fine at v1 scale; revisit when measurable.
- **Stefan's Attention List dashboard view.** Item 8 on the post-v1 priority list. This email is the v1 interface; the dashboard view consolidates these alerts and others later — that's the next feature on the roadmap.
- **Backfill / quiet-launch handling.** If pre-existing posts already have `rejectionCount >= 3` at deploy time, they fire on the first cron run after deploy. If Stefan wants to suppress that flood, he can SQL-stamp `regenLimitAlertedAt = now()` on those rows manually before merging.

## 11. Open questions for implementation

These don't change the design but will be resolved while writing code:

- Exact wording of the Dutch email subject and explanatory paragraph (friendly, warm — see project brand voice in `CLAUDE.md`).
- Whether to extract a small shared HTML-layout helper between `stale-post-email.ts` and `regen-limit-email.ts` (the wrapper, button, footer are identical). Decision: extract only if the implementation finds a third near-duplicate appearing; otherwise accept the duplication.
- Whether `findPostsAtRegenLimit` should bound its result set (e.g. `LIMIT 100`) defensively. The hourly cadence + per-post idempotency already bounds growth; likely unnecessary.
