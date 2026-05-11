# Owner Attention List — Design

**Date:** 2026-05-12
**Feature:** Stefan-facing "what needs me right now" dashboard pulling from already-stamped alert columns (Part A improvement #3)
**Status:** Design spec — NOT yet implemented. Needs Stefan to choose an aesthetic direction (§3a) before plan + implementation.

---

## 1. What we're building

A new page `/admin/attention` (and a redirect from `/admin`) that shows Stefan exactly what needs his attention across all clients, sorted by urgency. The current `/admin/page.tsx` is a raw `<table>` of users — useful at zero clients, useless at five or more. After this branch, `/admin` becomes the Attention List as the natural landing surface, with secondary nav to "All clients", "Generate preview", etc.

The data already exists. Every signal the Attention List shows is stamped or stamp-able from existing columns:

- `posts.firstSeenAt` (null) → not yet viewed by client
- `posts.alertedAt` → stale-post alert was sent
- `posts.regenLimitAlertedAt` → regen-limit alert was sent (client tried to regen 3×)
- `posts.publishError` → publish attempt failed (will populate once #5 ships)
- `posts.status = 'rejected'` + `posts.rejectedAt` → client rejected a post recently
- `posts.status = 'approved'` + `posts.approvedAt > publishAt` → approved but publish is overdue
- `clients.createdAt` recent + no posts → calibration period — Stefan should hand-check first generation

**No new schema.** Aggregation queries only.

## 2. Why these specific choices

| Decision | Choice made | Alternatives considered |
|---|---|---|
| Page location | Replace `/admin` → Attention List; move current user table to `/admin/users` | New `/admin/attention` route; keep current page as default (defeats purpose) |
| Data model | Query existing columns; no new table | Materialized view (premature); event log (different feature) |
| Refresh cadence | Static server-rendered on each request | Real-time websocket (Vercel Hobby doesn't support it; overkill) |
| Sort | By "urgency rank" defined as a constant ordering on signal type, then by signal age within type | Single composite numeric score (harder to debug); user-controlled sort (one user, one workflow, just bake in the right order) |
| Empty states | One per section — every section can be "all clear" individually | Single page-level empty state (misses the point — a healthy week means many sections empty) |
| One-click action | Each row deep-links directly to the relevant resource (post or client) — no in-place action | Inline approve/reject (couples this view to mutation logic; Stefan reviews INSIDE the client view, not here) |
| Self-resolution | Some signals self-clear when the underlying state resolves (e.g. "unseen draft" disappears when `firstSeenAt` is stamped). Stale-post and regen-limit signals stick around until the post is approved/rejected. | Manual dismiss button (extra UI state; existing columns already model this correctly) |
| Calibration awareness | New client (created in last 7 days) gets a soft "calibration" callout, NOT mixed into the urgent list | "New client" as a critical signal (it's reassuring not alarming) |

## 3. Architecture

### 3a. **Aesthetic direction** (NEEDS DECISION)

Stefan, you need to pick one before implementation. I (Claude) recommend Option A.

**Option A — "Operator console" (RECOMMENDED).** Sober, dense, terminal-adjacent. Inspired by Vercel's deployments page, Linear's inbox, and Splunk's alert lists. Mono-ish display font for counts/timestamps; sans for body. Each section is a horizontal stack of "alert chips" — one chip per item, color-coded by signal type. The look is "I'm in command of my agency, not buried in cards."

- Backgrounds: near-white, single very-light surface elevation
- Typography: Inter for body, JetBrains Mono for counts and timestamps
- Color: traffic-light only for severity (amber for warn, red for critical), otherwise grayscale
- Density: high — 12-15 items visible without scrolling on a 13" laptop
- Motion: none beyond browser-default focus rings

**Option B — "Editorial brief."** Magazine-style headings ("DEZE WEEK", "ACHTERSTAND", "BIJNA VERLOPEN"), generous whitespace, large numeric counts as type. One feature item per section gets a card-with-image treatment; the rest are list items. Feels like reading the morning paper.

- Backgrounds: warm off-white
- Typography: a serif display face (Fraunces, Newsreader, or Söhne Mono fallback) paired with Inter
- Color: muted earth palette with one accent for "needs you now"
- Density: medium
- Motion: subtle reveal on initial paint (justifiable for "morning briefing" feel)

**Option C — "Bento dashboard."** Each section becomes a tile in an asymmetric grid. Visual hierarchy by tile size; "Critical" gets the biggest tile, calibration gets the smallest. Familiar from modern SaaS dashboards.

- Backgrounds: soft tinted surfaces per tile
- Typography: a single sans (Inter / Geist)
- Color: per-tile accent
- Density: medium-low — designed to "look good" not "fit everything"
- Motion: hover lift on tiles

**Recommendation: Option A.** Stefan is one operator running an agency, not a marketer browsing a SaaS dashboard. Operator console rewards repeated use — every visit, the same shape of information appears in the same place; scanning becomes instant. Bento would be the right call for a *prospect* dashboard (e.g. a public demo); editorial would be the right call if Stefan invited monthly check-ins from clients. Neither matches "I have 4 minutes before my next client call — what fires need putting out."

If Stefan picks Option A: no design follow-up needed; the plan can start immediately.

If Stefan picks B or C: the implementation plan needs an additional pre-task to pick fonts + palette and (optionally) build a single mock screen for sign-off before the rest of the page lands.

### 3b. Page sections (regardless of aesthetic)

In order of urgency, top to bottom:

1. **Posts failed to publish** — `posts.status = 'failed' OR posts.publishError IS NOT NULL` (depends on #5; empty until #5 ships)
2. **Posts overdue** — approved, `publishAt < now`, `publishedAt IS NULL`. Will only be meaningful once the publisher runs but is correct today: an approved-but-unpublished post past its `publishAt` is already a problem (#5 will resolve via auto-publish, but for now Stefan should know).
3. **Stale drafts** — `alertedAt IS NOT NULL` (Stefan has been emailed). Sorted by `firstSeenAt` ascending.
4. **Regen-limit hit** — `regenLimitAlertedAt IS NOT NULL`. Sorted by `regenLimitAlertedAt` ascending.
5. **Unseen drafts** — `status = 'draft' AND firstSeenAt IS NULL`. Soft signal — client hasn't even seen them yet. Sorted by `createdAt` ascending.
6. **Recent rejections** — `status = 'rejected' AND rejectedAt > now - 7 days`. Pattern-finding section: "this client rejected 4 posts this week, retune profile."
7. **Calibration callouts** — clients with `createdAt > now - 7 days`. Soft.

Each section header carries a count badge (`Stale drafts (3)`). Each item carries:
- Client business name (linkable to client view)
- Platform pill (IG/FB)
- Scheduled date
- Signal age (e.g. "26h", "3d")
- Right-aligned chevron / action area

### 3c. Files to create or modify

#### New files

| Path | Purpose |
|---|---|
| `src/app/admin/attention/page.tsx` | The Attention List server component (or rendered AT `/admin` if we redirect) |
| `src/lib/admin/attention.ts` | Aggregation queries — one function per section, plus a combiner |
| `src/lib/admin/__tests__/attention.test.ts` | PGlite-based tests for each query under realistic seed data |
| `src/components/admin/attention-section.tsx` | Reusable section wrapper (header + count badge + empty state + items list) |
| `src/components/admin/attention-item.tsx` | Reusable per-item row |
| Possibly `src/styles/admin-tokens.css` if aesthetic A requires CSS custom properties for the operator-console palette |

#### Modified files

| Path | Change |
|---|---|
| `src/app/admin/page.tsx` | Replace with Attention List (or redirect to it); move the existing user-table content to `/admin/users` |
| `src/app/admin/layout.tsx` (if exists; create if not) | Add admin-level nav: Attention, Clients, Users, Generate |

### 3d. Aggregation function shape

```ts
// src/lib/admin/attention.ts

export interface AttentionItem {
  signalType: 'failed' | 'overdue' | 'stale' | 'regen-limit' | 'unseen' | 'rejected'
  postId: string | null  // null for calibration items
  clientId: string
  businessName: string
  platform?: 'instagram' | 'facebook'
  scheduledDate?: string
  signalAt: Date  // the timestamp on which the signal is anchored
  contentPreview?: string  // first 80 chars of the post content
}

export interface CalibrationItem {
  clientId: string
  businessName: string
  joinedAt: Date
  postCount: number  // 0 = generation hasn't happened yet
}

export interface AttentionData {
  failedPosts: AttentionItem[]
  overduePosts: AttentionItem[]
  staleDrafts: AttentionItem[]
  regenLimitHits: AttentionItem[]
  unseenDrafts: AttentionItem[]
  recentRejections: AttentionItem[]
  calibrationClients: CalibrationItem[]
}

export async function getAttentionData(
  db: Db,
  now: Date
): Promise<AttentionData>
```

Each section is a separate function internally (testable in isolation) composed into the combiner.

### 3e. Index considerations

Most queries already have supporting indexes:

- `posts_status_publish_idx` covers "overdue" and "failed" queries
- `posts_stale_alert_idx` covers "stale" query
- `posts_client_date_idx` is general-purpose

The "unseen drafts" query (`status='draft' AND firstSeenAt IS NULL`) and "regen-limit" query (`regenLimitAlertedAt IS NOT NULL`) currently lack covering indexes. v1 ships without new indexes — these queries are bounded by `status='draft'` (small subset). Revisit if EXPLAIN ANALYZE shows seq scans being slow.

## 4. Testing strategy

### Unit tests (Vitest + PGlite)

`attention.test.ts` — one `describe` per section. For each section:
- Empty case (no matching rows): returns `[]`
- Single-match case: returns one item with the right shape
- Sorting verified across 3+ items
- Excludes posts that don't belong (sanity: e.g. published posts excluded from "stale drafts")
- Cross-client visibility: Stefan sees signals across ALL clients (no `clientId` filter, but tests assert this explicitly)

`getAttentionData` integration test:
- Seed two clients with a mixture of signals
- Confirm each section has the expected items
- Confirm sections are independent (a failure in one doesn't affect another)

### Visual / e2e

Defer to implementation — manual browser check after each section lands. No Playwright tests in v1 (per `docs/architecture-review-2026-05-11.md` the testing strategy doesn't yet include E2E).

## 5. Explicitly out of scope

- **Inline actions.** Approve, reject, cancel, retune — all happen on the client's page, not here.
- **Search / filter / pagination.** v1 ships everything. If sections grow past 20 items each (i.e. Stefan has dozens of clients), we revisit — likely with collapse-by-default per section.
- **Customizable urgency ranking.** One operator, one workflow, no preference system.
- **Cross-section deduplication.** A post that's both "stale" and "regen-limit" appears in both sections. Each signal is independently actionable; collapsing them hides information.
- **"Snooze" or "dismiss".** Stefan resolves signals by acting on them (approving the post, retuning the profile, etc.). A snooze button creates state-management debt.
- **Push notifications / mobile-specific layout.** Stefan is on a laptop. The page is responsive enough on phones for the rare mobile glance, but is not designed for thumb-friendly tap targets.
- **Per-client roll-up summary** ("Café Test Arnhem has 3 issues"). Implicit in the data — Stefan sees this naturally when the same business name appears in multiple sections.
- **Configurable thresholds.** "Stale" means 24h (already enforced upstream by the alert cron); "rejected recently" means 7 days; these are baked in. If they need to change, the spec changes, not a settings panel.

## 6. Open questions for implementation

- **Server Action vs simple `<a>` for "go to client."** Plain anchor link, no action needed.
- **How to render the count badge during initial paint?** Server-rendered count, no skeleton needed — the query is fast and the page is fully SSR.
- **Whether to include "Posts not yet approved 12+ hours old" as a separate soft section.** Probably overlaps with stale-drafts; defer.
- **Once #5 ships:** the "failed" and "overdue" sections become hot. The publisher should write `publishError` on transient failures so this list reflects reality. Spec'd separately in #5.
- **Should "calibration" include a one-line action ("Generate first week")?** Yes if it's a cheap link; no if it implies inline state.
- **If the user picks aesthetic B or C in §3a:** the implementation plan adds a pre-task: invoke the `frontend-design` skill with the chosen direction and produce a single mock screen for sign-off before the page lands.

## 7. Suggested first prompt for implementation session

When ready to build this, paste into a fresh chat:

> Read `docs/superpowers/specs/2026-05-12-attention-list-design.md`. I picked aesthetic Option [A/B/C]. Now use `writing-plans` to produce the bite-sized plan. If I picked B or C, the plan must start with a `frontend-design` pre-task. Then we'll execute task by task with `subagent-driven-development`.
