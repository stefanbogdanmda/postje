# Photo-Grounded Post Generation — Design Spec

**Date:** 2026-05-07
**Status:** Draft
**Depends on:** Post generation prototype (Session 5)

## Summary

Extend the post generation pipeline so that Claude can see client photos and write posts grounded in what it sees. Photos drive the writing — Claude reads the mood, contents, and brand relevance of a photo and produces Instagram captions and Facebook posts that tell the brand's story through that image.

The photo analysis runs once at upload time and persists to the database. The generation pipeline consumes stored analysis and the raw image. If no photos are available, the pipeline falls back to text-only behavior with no errors.

## Scope

**In scope:**
- `photos` table with foreign key to `clients.id` (multi-client-ready)
- Vercel Blob storage for photo files
- Admin upload API endpoint
- Photo analysis via Claude vision (upload-time, persisted)
- Manual retry endpoint for failed analysis
- Plan stage: assigns analyzed photos to days
- Write stage: sends photo + analysis to Claude for photo-grounded posts
- Preview page: side-by-side platform previews for photo days
- Hardcoded to Café de Hoek profile

**Out of scope:**
- Client-facing upload UI
- Post persistence (posts table)
- Dynamic client selection
- Automatic retry / queue for failed analysis

## Data Model

### `photos` table

| Column | Type | Nullable | Purpose |
|--------|------|----------|---------|
| `id` | text (UUID) | no | Primary key |
| `clientId` | text | no | Foreign key → `clients.id` |
| `blobUrl` | text | no | Vercel Blob URL (public) |
| `originalFilename` | text | no | Client's original filename |
| `mimeType` | text | no | image/jpeg, image/png, image/webp |
| `sizeBytes` | integer | no | File size in bytes |
| `analysis` | typed JSON | yes | Structured `PhotoAnalysis` output from Claude vision |
| `analyzedAt` | timestamp | yes | When analysis completed successfully |
| `createdAt` | timestamp | no | When the photo was uploaded |

**Key decisions:**
- `analysis` and `analyzedAt` are nullable. A photo can exist before analysis completes or if analysis fails. The pipeline handles "uploaded but not yet analyzed" by treating unanalyzed photos as unavailable.
- `analysis` uses Drizzle's typed JSON column pattern — the TypeScript type is the structured `PhotoAnalysis` shape, not a raw string. No `JSON.parse` at consumption sites.
- `clientId` foreign keys to `clients.id` so the storage layer is multi-client-ready from day one, even though only Café de Hoek exists in v1.

### `PhotoAnalysis` type

```typescript
interface PhotoAnalysis {
  subjects: string[]        // what's in the photo: "cappuccino", "outdoor terrace", "pastry display"
  mood: string              // emotional tone: "cozy", "energetic", "intimate"
  season: string | null     // if detectable: "autumn", "summer", null
  setting: string           // where: "indoor café", "sidewalk seating", "kitchen"
  brandAngles: string[]     // how this connects to the brand: "barista craftsmanship", "seasonal menu"
  visualDetails: string     // one paragraph of rich description Claude can reference when writing
}
```

## Photo Storage (Vercel Blob)

Photos are stored in Vercel Blob (free tier, 250MB — sufficient for early use).

**Upload flow:**
1. Admin API endpoint receives a photo file + `clientId`
2. Server validates: file size ≤ 5MB, mime type is JPEG/PNG/WebP
3. File is uploaded to Vercel Blob → returns a permanent public URL
4. A row is created in the `photos` table with the blob URL and metadata, `analysis: null`
5. Photo analysis runs in the same request after the row is created — the upload endpoint calls the analysis function, stores the result, then responds. Analysis failure does not roll back the upload.
6. If analysis fails, the row remains with `analysis: null` — upload itself does not fail

**Upload response shape:**
```typescript
{
  photo: PhotoRow           // the created DB row (always present on 200)
  analysisStatus: "succeeded" | "failed"
  error?: string            // human-readable reason when analysisStatus is "failed"
}
```
The endpoint always returns 200 if the upload + DB row succeeded. The caller checks `analysisStatus` to know whether the photo is ready for generation or needs a manual retry.

**Upload and analysis are independent operations.** Upload succeeds regardless of whether analysis succeeds. No orphaned blobs, no rolled-back rows leaving stranded files.

**Upload constraints:**
- Max file size: 5MB (Claude vision API limit is 5MB per image; aligning the upload limit avoids resize logic)
- Accepted types: JPEG, PNG, WebP
- Validated server-side before uploading to Blob

**Public URL note:** Vercel Blob URLs are public-by-URL. This is fine for café photos destined for Instagram/Facebook. When the client-facing upload UI is built later, revisit whether signed/expiring URLs are needed for photos that aren't intended for public social media.

## Photo Analysis (Upload-Time)

Runs once per photo at upload time. Not part of the generation pipeline.

**Process:**
1. Read the photo from Vercel Blob (URL-based — no base64 encoding needed)
2. Send to Claude vision API (`claude-sonnet-4-6`) with a structured analysis prompt
3. Parse response into `PhotoAnalysis` shape
4. Store in `photos.analysis`, set `photos.analyzedAt`

**Image input format:** URL source type — `{ type: "image", source: { type: "url", url: blobUrl } }`. Vercel Blob URLs are publicly accessible, so Claude can fetch them directly.

**Error handling:** If analysis fails (API error, content policy, timeout), the photo stays with `analysis: null`. No automatic retry.

**Retry mechanism (v1):** A simple admin API endpoint `POST /api/photos/[id]/analyze` re-triggers analysis for a specific photo. No queue, no automatic retry — manual re-trigger only.

**Model:** `claude-sonnet-4-6` — same model as the generation pipeline. Vision is strong at this tier and keeps costs predictable.

**Cost:** A typical 1000×1000 photo ≈ 1,334 vision tokens ≈ $0.004. Analysis runs once per photo, so cost is negligible.

## Generation Pipeline Changes

The pipeline stays two stages (plan → write). Both stages are now photo-aware.

### Plan Stage

**Input changes:**
- Receives a list of available photos with their stored `PhotoAnalysis` (not the raw images — text only, no vision cost)
- Only photos with non-null `analysis` are included. Unanalyzed photos are filtered out before the plan stage sees them.

**Output changes:**
- Each day in the weekly plan gains a `photoId: string | null` field — which photo is assigned to that day, or null for text-only

**Distribution rules:**
- If analyzed photos are available, Claude assigns them to days across the week
- **Hard rule (enforced in prompt): no two photo days back-to-back.** This prevents clustering and ensures visual variety in the week's content.
- Beyond the adjacency rule, photo distribution relies on Claude's judgment. See Open Questions for the deferred decision on tightening this.

**Zero-photos case:** If no analyzed photos are available, the pipeline produces a fully text-only week — identical to current behavior. The plan stage sees "0 photos available" and generates text-only plans. No errors, no degraded state.

### Write Stage

**For photo days:**
- Claude receives: brand profile + day plan + stored `PhotoAnalysis` + the actual photo (via vision API URL source)
- The analysis gives Claude a head start; the raw image lets it catch nuances the analysis might have flattened
- Claude writes posts that are grounded in what it sees AND the brand context AND the mood/atmosphere of the photo

**For text-only days:**
- Works exactly like it does today — no changes

**Output changes:**
- `DayPosts` type gains: `photoId: string | null` and `photoUrl: string | null`
- These let the preview page know which posts have photos and where to load them from

**Validation:**
- Existing validation (banned phrases, sentence length) applies to photo-grounded posts identically
- Unanalyzed photo reaching the write stage is logged server-side as an error (should never happen — the plan stage only assigns photos with non-null analysis). Not surfaced in the UI.

**Token cost:** Each photo hits vision API once at write time. Text-only days cost the same as today. Plan stage is text-only — no vision cost. A week with 3 photos: ~$0.012 additional vision cost at write time.

## Preview Page Changes

### Photo days — side-by-side platform previews

Each photo day renders as two columns:
- **Instagram preview:** Photo at top, caption below
- **Facebook preview:** Photo at top, post text below
- Photos load from the Vercel Blob URL
- Below the side-by-side previews: reasoning and English summary (same as today)
- Small label indicating "Photo post"

### Text-only days — unchanged

Same card layout as the current preview.

### Photo analysis panel

For photo days, a collapsible section below the day card showing what Claude "saw":
- Subjects, mood, season, setting, brand angles
- Makes the connection between image and text transparent for the admin

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/photos/upload` | POST | Upload photo file + clientId → Blob + DB row + trigger analysis |
| `/api/photos/[id]/analyze` | POST | Re-trigger analysis for a specific photo (manual retry) |
| `/api/generate-posts` | POST | Existing — extended to accept photo context and return photo assignments |

## Technical Details

### Claude Vision API format

```typescript
// In message content array, alongside text blocks:
{
  type: "image",
  source: {
    type: "url",
    url: "https://abc123.public.blob.vercel-storage.com/photo.jpg"
  }
}
```

### Model

`claude-sonnet-4-6` for all stages (analysis, plan, write). Consistent model choice keeps behavior predictable.

### Dependencies

- `@vercel/blob` — Vercel Blob SDK for file uploads
- No other new dependencies expected

## Open Questions

- **Photo distribution quality beyond the adjacency rule.** The hard rule prevents back-to-back photo days, but broader distribution ("spread evenly," "match photo mood to day theme") relies on Claude's judgment. Observe the first several generation runs and tighten with additional hard rules if Claude's choices feel wrong. Deferred to runtime observation, not a blocker for implementation.

## Decisions Log

| Decision | Rationale |
|----------|-----------|
| Photos drive writing (not matched after) | Most valuable version — text comes from the image |
| Three-stage hybrid → analysis at upload time | Analysis runs once, persists to DB. Pipeline stays two stages. |
| Typed JSON for analysis column | No JSON.parse everywhere, cleaner Postgres migration path |
| Nullable analysis/analyzedAt | Photos can exist before analysis completes or on failure |
| Manual retry via admin endpoint | Simple, sufficient for v1. No queue infrastructure needed. |
| No adjacent photo days (hard rule) | Prevents clustering, learned from Session 5's soft constraint issues |
| 5MB upload limit | Matches Claude API limit. No resize logic to maintain. |
| URL source type for vision | Blob URLs are public, no encoding overhead, smaller request payloads |
| Unanalyzed photo = server log, not UI warning | Plan stage filters them out. Surfacing impossible states creates noise. |
| Public Blob URLs flagged for future review | Fine for café photos going to social media. Revisit for client upload UI. |
| Zero photos = text-only week, no errors | Pipeline gracefully degrades to current behavior |
