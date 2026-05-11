# Stale Post Alerts — Design

**Date:** 2026-05-11
**Feature:** 24-hour approval timer + Stefan notification (item 2 from the post-v1 priority list)
**Status:** Design complete, ready for implementation plan

## 1. What we're building

A scheduled job that runs hourly during Dutch business hours (Mon–Fri, 09:00–18:00 Europe/Amsterdam). Each run, it finds posts that:

- are still in `draft` status (not approved, rejected, or published)
- the client has already seen at least once on their dashboard
- have been sitting unreviewed for more than 24 hours since first seen
- haven't already triggered an alert

For each match, the system emails Stefan a notification containing the client name, a preview of the post content, the platform (Instagram or Facebook), the scheduled date, and a link to the client's admin page (`/admin/clients/[id]`). The post is then marked as "already alerted" so the same post never triggers a second email.

The system does **not**:

- notify the client
- auto-publish the post
- auto-skip the post
- re-alert if the post stays in draft

The post sits in `draft` indefinitely until Stefan reaches out personally and the client either approves it, rejects it, or Stefan manually intervenes.

## 2. Why these specific choices

This is the place to capture *why* the design looks the way it does, because the choices have non-obvious tradeoffs. The brainstorm covered each of these explicitly.

| Decision | Choice made | Alternative considered |
|---|---|---|
| Per-post vs per-batch timer | Per-post | Per-batch hides "reviewed 4 of 6, ignored 2" |
| Digest vs individual emails | Individual emails per post | Digest delays urgent alerts |
| Clock start | When client first sees the post | createdAt would alert on never-logged-in clients (separate feature) |
| Re-alerting policy | One alert per post, ever | Re-alerting creates inbox spam if Stefan is away |
| Email content | Standard (client name + post preview + link) | Minimal forces a click; rich requires features we don't have |
| Delivery timing | Mon–Fri 09:00–18:00 Europe/Amsterdam only | Strict 24h fires at 3am Sunday and can't be acted on |

## 3. Architecture

Two new mechanisms:

### 3a. "First seen" tracking

Runs as part of the existing dashboard data load. Whenever a client opens their dashboard and we fetch their pending posts, we stamp `firstSeenAt = now()` on any of those posts whose `firstSeenAt` is currently NULL. Posts that haven't been seen yet have NULL and don't have a clock running.

This is one extra UPDATE statement per dashboard load, scoped to the client's own posts only. Cheap.

### 3b. Hourly cron — `/api/cron/check-stale-posts`

Protected by `CRON_SECRET` (Vercel's standard pattern — `Authorization: Bearer <secret>` header required).

Each invocation:

1. Read current time, check it falls within Mon–Fri 09:00–18:00 Europe/Amsterdam.
2. If outside business hours: return 200 with body `{ skipped: true, reason: "outside business hours" }` and exit. No further work.
3. Otherwise: query for `posts` where `status = 'draft'` AND `firstSeenAt IS NOT NULL` AND `firstSeenAt < now() - 24h` AND `alertedAt IS NULL`.
4. For each matching post:
   - Look up the post's client (need `businessName` for the email).
   - Send email to Stefan via Resend.
   - On send success: `UPDATE posts SET alertedAt = now() WHERE id = ?`.
   - On send failure: log the error and skip — do NOT mark `alertedAt`. Next hour retries.
5. Return 200 with `{ skipped: false, alertsSent: N, alertsFailed: M }`.

Scheduling: `0 * * * *` (top of every hour, 24x daily). The business-hours gate inside the handler means only ~9 of those runs actually do work; the other 15 exit early in <50ms.

## 4. Data model changes

### posts table additions

| Column | Type | Default | Purpose |
|---|---|---|---|
| `firstSeenAt` | `integer` (timestamp_ms), nullable | `NULL` | When the client first loaded a dashboard that included this post |
| `alertedAt` | `integer` (timestamp_ms), nullable | `NULL` | When Stefan was emailed about this post (NULL = not yet) |

### New index

`posts_stale_alert_idx` on `(status, firstSeenAt, alertedAt)` — supports the cron query without a full scan.

### Migration handling for existing posts

Existing draft posts at the time this feature ships have NULL `firstSeenAt` and NULL `alertedAt`. With NULL `firstSeenAt`, the cron query excludes them naturally — they only start participating in the timer when their client next opens the dashboard (which is the desired semantics anyway).

No backfill needed. No mass-alert on the first cron run.

## 5. Files to create or modify

### New files

| Path | Purpose |
|---|---|
| `src/db/migrations/NNNN_add_stale_alert_tracking.sql` | Adds the two columns + index |
| `src/lib/time/business-hours.ts` | Pure function: `isWithinNLBusinessHours(now: Date): boolean` |
| `src/lib/time/__tests__/business-hours.test.ts` | Unit tests for the time logic, including DST |
| `src/lib/alerts/stale-post-email.ts` | Composes + sends the alert email via Resend |
| `src/app/api/cron/check-stale-posts/route.ts` | The cron endpoint |
| `vercel.json` | Project root — registers the cron job |

### Modified files

| Path | Change |
|---|---|
| `src/db/schema.ts` | Add `firstSeenAt` and `alertedAt` columns + index definition |
| `src/lib/posts/repository.ts` | Add `markPostsAsSeen(db, postIds, clientId)` and `findStalePosts(db, now)` |
| `src/lib/posts/__tests__/repository.test.ts` | Tests for the new repository functions |
| Wherever the client dashboard fetches pending posts (probably `src/app/dashboard/page.tsx` or a server action it calls) | Invoke `markPostsAsSeen` for fetched drafts whose `firstSeenAt` is currently NULL |
| `.env.example` | Document `CRON_SECRET` and (if not already present) the existing `RESEND_*` and admin email vars |

## 6. Error handling

| Failure mode | Behavior |
|---|---|
| Resend email send fails (network, rate limit, etc.) | Log via `console.error` with context; do NOT set `alertedAt`. Next cron run retries the same post. |
| DB error mid-cron | Return 500. Vercel does not retry crons automatically on Hobby tier. The next scheduled hour handles it. |
| Cron called without correct `CRON_SECRET` | Return 401 with empty body. Do not log (avoid log spam from scanners). |
| Outside business hours | Return 200, `{ skipped: true, reason: "outside business hours" }`. Single log line. |
| Client lookup fails (orphan post, FK violation impossible due to schema but defensive) | Log and skip that post. Continue with the rest. |
| Multiple posts match | Process sequentially. Each row's success/failure is independent. |

The idempotent pattern (always-filter-out-already-alerted) means running the cron twice in close succession is harmless — no duplicate alerts.

## 7. Testing strategy

### Unit tests (Vitest)

`business-hours.test.ts`:

- Monday 10:00 Amsterdam → true
- Monday 08:59 Amsterdam → false
- Monday 18:01 Amsterdam → false
- Saturday 12:00 Amsterdam → false
- Sunday 12:00 Amsterdam → false
- DST transition day (last Sunday in March, last Sunday in October) — confirm UTC conversion is correct
- Input given in UTC, function does the timezone conversion internally

`repository.test.ts` additions for `findStalePosts`:

- Returns posts that match all criteria
- Excludes posts with `status = 'approved'`
- Excludes posts with `firstSeenAt IS NULL`
- Excludes posts with `firstSeenAt > now - 24h`
- Excludes posts with `alertedAt IS NOT NULL`
- Returns multiple posts when multiple match

`repository.test.ts` additions for `markPostsAsSeen`:

- Sets `firstSeenAt` on posts where it was NULL
- Does NOT overwrite existing `firstSeenAt` values
- Only affects posts owned by the given client (multi-tenant isolation check)

### Manual integration test

1. In dev: insert a draft post for a test client.
2. Update its row: `firstSeenAt = now() - 25 hours`, `alertedAt = NULL`.
3. Force "business hours" by mocking time, or run the test during real NL business hours.
4. Hit `/api/cron/check-stale-posts` with the correct `CRON_SECRET`.
5. Confirm: Stefan's inbox receives the email, the post row now has `alertedAt` set.
6. Hit the endpoint again: confirm no duplicate email, response shows `alertsSent: 0`.

### Production smoke test (post-deploy)

After first deploy, manually create a draft post with backdated `firstSeenAt`, wait for the next cron run during business hours, confirm email arrives.

## 8. Environment variables

| Variable | Status | Purpose |
|---|---|---|
| `CRON_SECRET` | **New** — add to Vercel + `.env.local` + `.env.example` | Validates cron requests come from Vercel |
| `AUTH_RESEND_KEY` | Already exists (used for magic links) | Reused for alert emails too — one Resend account, multiple use cases |
| `EMAIL_FROM` | Already exists (defaults to `onboarding@resend.dev`) | Sender address for alert emails |
| `ADMIN_EMAIL` | **New** — add to Vercel + `.env.local` + `.env.example` | Stefan's inbox. The destination for every alert email. Hardcoding it would be wrong; an env var lets it differ between dev and prod. |

**Naming note:** `AUTH_RESEND_KEY` will be slightly misleading once it's also used for non-auth emails. Renaming to `RESEND_API_KEY` is a small follow-up cleanup, not part of this feature's scope.

## 9. Explicitly out of scope

These came up in the brainstorm and were consciously deferred:

- **Re-alerting / escalation.** One alert per post forever. If Stefan misses the email, the system goes silent on that post.
- **Client-facing nudges.** No banner, no in-app reminder, no email to the client. The existing dashboard already shows pending posts as a nudge.
- **NL public holidays.** Koningsdag, Kerst, Pinksteren — alerts fire on these days in v1. Revisit if it becomes annoying in practice.
- **Per-post dismiss / snooze.** Not needed — Stefan resolves manually and the post leaves draft state anyway.
- **"Never logged in at all" alert.** This is a separate feature. Posts with NULL `firstSeenAt` are silent here by design; that's the gap a future feature would fill.
- **Stefan's Attention List dashboard view.** Item 8 on the priority list. The email is the v1 interface. The dashboard view aggregates these and other alert sources later.
- **Digest emails.** Each post triggers its own email. If a client ignores 6 posts, Stefan gets 6 emails. Trade-off chosen for immediacy.
- **Backfill of existing posts.** Existing drafts at deploy time stay silent until their client next logs in (NULL `firstSeenAt` excludes them from the cron query naturally).

## 10. Open questions for implementation

These are details that don't change the design but need to be resolved when writing the code:

- Exact location of the "where dashboard fetches pending posts" call site — I'll find it during planning.
- Whether `markPostsAsSeen` should run synchronously (blocking the dashboard response) or via `waitUntil` (non-blocking, fire-and-forget). The UPDATE is fast enough that synchronous is fine, but `waitUntil` is cleaner.
- Whether to use `date-fns-tz` or built-in `Intl.DateTimeFormat` for the timezone conversion. Both work; pick whichever has less weight.
- Exact wording of the email subject and body (Dutch, friendly tone per project brand voice).
