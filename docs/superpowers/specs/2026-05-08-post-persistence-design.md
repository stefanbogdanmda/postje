# Post Persistence Design

**Date:** 2026-05-08
**Status:** Approved
**Ship deadline:** Saturday 2026-05-10 (Cafe de Hoek end-to-end)
**Depends on:** Existing `clients` and `photos` tables, `/api/generate-posts` pipeline
**Enables:** Client review UI (next feature)

## Purpose

Generated posts currently exist only as in-memory API responses. Before the client review/approval UI can work, posts need to live in the database so they can be read, edited, approved, rejected, and published.

This feature adds the `posts` table and rewrites the generation flow to persist posts to the database. It has no UI of its own — it's the data layer for the approval loop.

## Schema: `posts` table

One row per platform per day. A Monday post for a client with both Instagram and Facebook produces two rows.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text (UUID) | Primary key, generated at insert |
| `clientId` | text (UUID) | FK → `clients.id`, cascade delete |
| `platform` | text | `instagram` \| `facebook` |
| `scheduledDate` | text (ISO date) | The day this post is for, e.g. `2026-05-11` |
| `status` | text | `draft` \| `approved` \| `rejected` \| `published` \| `failed` |
| `content` | text | The caption/post text for this platform |
| `photoId` | text, nullable | FK → `photos.id`, null for text-only posts |
| `reasoning` | text | Claude's English explanation of why this post works |
| `publishAt` | integer (unix timestamp), nullable | Exact publish time. Null for drafts, set on approval from industry config defaults |
| `rejectionCount` | integer, default 0 | Incremented on rejection. Capped at MAX_REJECTIONS by application logic |
| `approvedAt` | integer (unix timestamp), nullable | When approved |
| `rejectedAt` | integer (unix timestamp), nullable | When last rejected |
| `publishedAt` | integer (unix timestamp), nullable | When actually published to platform |
| `publishError` | text, nullable | Error message if publishing failed |
| `createdAt` | integer (unix timestamp) | Row creation time |
| `updatedAt` | integer (unix timestamp) | Last modification time |

### Indexes

- `clientId + scheduledDate` — primary query: "all posts for this client this week"
- `status + publishAt` — cron query: "approved posts ready to publish now"
- `clientId + scheduledDate + platform` — unique constraint: one post per client per day per platform

### What's deliberately excluded

- **No `week` column.** Week grouping is derived from `scheduledDate` via date range queries.
- **No `superseded` status.** Old drafts are deleted on regeneration. Generation history belongs in a purpose-built logging table if it ever proves valuable.
- **No original content columns** (`originalInstagramCaption`, etc.). No v1 UI surface reads them. If calibration needs Claude-vs-edit diffs, add them before calibration starts.
- **No `dayTheme` / `dayAngle` columns.** Plan-stage metadata without a consumer in the review UI. The `reasoning` field carries the useful debugging signal.
- **No platform-specific publish tracking beyond status.** Each platform row has its own `status`, `publishedAt`, and `publishError`. No cross-platform coordination columns needed.

## Statuses

| Status | Meaning | Transitions to |
|--------|---------|----------------|
| `draft` | Generated, waiting for review | `approved`, `rejected`, or deleted on regeneration |
| `approved` | Client approved, scheduled for publishing | `published`, `failed` |
| `rejected` | Client rejected | Deleted and replaced on regeneration (count carries forward) |
| `published` | Successfully posted to platform | Terminal |
| `failed` | Publishing attempt failed | `published` (on retry) |

## Rejection semantics

- **Rejection is per-day, not per-platform.** When Marloes rejects, both platform rows for that day get `rejectionCount` incremented together in one transaction.
- **Rejection count carries forward through regeneration.** Before deleting rejected rows, the endpoint reads `rejectionCount` per `(clientId, scheduledDate, platform)`. New draft rows inherit the count.
- **MAX_REJECTIONS** (set to 3 for v1) is enforced in application logic. When hit, the backend refuses further rejections and flags Stefan. The review UI disables the reject button — that UX is a review UI concern, not this feature.

## Scheduling

- **`scheduledDate`** (which day) is set at generation time.
- **`publishAt`** (exact timestamp) is set at approval time from industry-default config.
- **Industry defaults** live in a config map in code: `{ cafe: "08:00", bakery: "07:00", restaurant: "11:00" }`. Per-client overrides are a future migration if needed.
- **`publishAt` is nullable** at the column level. Application logic guarantees it is non-null before status flips to `approved`.
- The review UI will support time overrides — Marloes can change `publishAt` before or during approval. That's a review UI concern.

## Generation flow

### Current flow (replaced)

```
POST /api/generate-posts (no params)
  → hardcoded client, no date awareness
  → run plan + write stages
  → return full post content in response
  → preview renders from response body
```

### New flow

```
POST /api/generate-posts { clientId, startDate }
  → endDate = startDate + 6 days
  → query existing posts in range
  → identify locked days (any day with at least one approved/published/failed row)
  → identify open days (all rows are draft/rejected, or no rows exist)
  → if no open days → return { nothing to generate }
  → read rejectionCounts from rejected rows before deleting
  → delete draft + rejected rows for open days (in transaction)
  → run plan stage with locked days as constraints
  → run write stage
  → insert new rows with inherited rejectionCounts (same transaction)
  → return { clientId, startDate, endDate, generatedCount, skippedLockedCount }
```

### Reading posts (new endpoint)

```
GET /api/posts?clientId=X&startDate=Y&endDate=Z
  → all three parameters required
  → max 31-day range enforced
  → returns posts grouped by scheduledDate
  → each day contains its platform rows
```

### Key design decisions

1. **Persist-then-read (Approach A).** Generation writes to DB, all consumers (preview and review) read from DB. Single source of truth, single data path.

2. **Delete-before-insert on regeneration.** Old drafts and rejected rows are deleted, not soft-replaced. Approved/published/failed rows are never touched.

3. **Response is a pointer, not content.** Generate returns a confirmation with counts. The preview page fetches posts via `GET /api/posts`. Two calls, same data path as the review UI.

4. **Transactional writes.** All deletes and inserts for a generation run happen in one Drizzle transaction. Either the whole batch writes or nothing does.

5. **Generation takes parameters.** `clientId` and `startDate` are required. No more hardcoded client or dateless generation.

## Plan stage changes

### Locked-day context

The plan prompt receives locked days as already-realized plan output, not as gaps. This is critical for the photo adjacency rule (no back-to-back photo days).

The only information available for locked days is what's stored on the post row: `scheduledDate`, `photoId` (present or null), and `content`. Theme and angle are not stored and must not be fabricated. The adjacency rule only needs to know whether a locked day has a photo or not.

Example prompt context:
```
The following days are already planned and locked. Do not change them.
Plan new content only for the open days listed after.

LOCKED:
- Monday 2026-05-11: photo assigned (photo-uuid-1)
- Tuesday 2026-05-12: text-only

OPEN (plan these):
- Wednesday 2026-05-13
- Thursday 2026-05-14
- Friday 2026-05-15
```

### Scope constraint

This change adds locked-day context to the plan prompt via string append to the existing user prompt template. No structural rewrite of the prompt. Nothing else changes in the prompt. If voice quality shifts after this lands, attribution must be clean. Voice quality investigation is a separate workstream.

## Carry-forward notes for review UI

These decisions were made during this design but are implemented in the review UI feature, not this one:

1. **Approve/reject updates two rows in a transaction.** Drizzle supports this cleanly. Partial approval or partial rejection (one platform row updated, one not) must not be possible. This applies to both the approval and rejection endpoints.
2. **MAX_REJECTIONS UX.** When hit, reject button is disabled with a message. Stefan is notified.
3. **Time override on approval.** Marloes can change `publishAt` before approving. Auto-filled from industry defaults, editable when she cares.

## What this feature does NOT include

- No review UI (next feature)
- No publishing/cron job
- No Meta API integration
- No generation logging/history table
- No original-vs-edited content tracking
- No rejection reason text capture
