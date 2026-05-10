# Client Dashboard & Approval UI — Design Spec

**Date:** 2026-05-11
**Status:** Approved
**Ships:** Saturday 2026-05-11

## Overview

The client dashboard is the primary interface for Social AI clients. After logging in via magic link, clients land here to review, edit, approve, or reject their weekly social media posts. This is the first client-facing feature — everything before this was admin tooling.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Dashboard layout | Stacked sections | Pending posts are the hero. SMB clients want one clear action, not a project board. |
| Approval view | Slide-over panel (~60% width) | Feels faster than a full page. Client can review multiple posts without navigating away. |
| Slide-over layout | Split (preview left, actions right) | "See it, tweak it, approve it" without scrolling. Stacks on mobile. |
| Date display | Once, in actions panel only | Avoid redundancy — date not repeated under preview. |
| Request changes | Inline expansion | Feedback textarea replaces buttons in-place. No modal, no navigation. |
| Skip/reject | Mark as rejected, no feedback | Clean opt-out. Rejection feedback loop is a separate future feature. |
| Caption editing | Always-editable textarea | No separate "edit mode." Textarea is live. Blue border + "bewerkt" indicator when modified. |

## 1. Client Dashboard (`/dashboard`)

### Layout

Three stacked sections, top to bottom:

**Header:**
- "Social AI" branding (small, uppercase, muted)
- Business name (prominent)
- "Log uit" button (right-aligned)

**Section 1 — "Wacht op goedkeuring" (Pending):**
- Primary CTA area, always first
- Red count badge in section header
- Card grid: 2 columns on desktop, 1 on mobile
- Each card shows:
  - Photo thumbnail (from Vercel Blob URL via `photoId`)
  - Caption preview (~2 lines, truncated with CSS)
  - Scheduled date (e.g., "ma 12 mei")
  - Platform badge on thumbnail (IG gradient / FB blue icon)
- Click any card → opens slide-over panel
- Posts shown: `status === "draft"`

**Section 2 — "Binnenkort gepland" (Upcoming):**
- Horizontal scroll of compact day chips
- Green-tinted cards (`#f0fdf4` background, `#bbf7d0` border)
- Each chip: day name + date, post count, platform icons
- Read-only — no click action
- Posts shown: `status === "approved"`, scheduled date >= today

**Section 3 — "Recent geplaatst" (Published):**
- Simple list rows, last 5 posts
- Each row: small thumbnail, caption preview, date + platform, metrics
- Metrics stubbed as "—" (Meta API not wired yet)
- Posts shown: `status === "published"`, ordered by publishedAt desc

### Empty States (Dutch)

- Pending: "Geen posts om te beoordelen. Alles is up-to-date!"
- Upcoming: "Nog geen goedgekeurde posts deze week."
- Published: "Nog geen posts geplaatst."

### Data Loading

Server component. Fetches posts using existing `getPostsByDateRange` from `src/lib/posts/repository.ts`. Date range: current week (Monday–Sunday). Filters by session user's `clientId`. Groups posts by status in the server component — no client-side fetching for the initial load.

Requires resolving `clientId` from the session's `userId` via the `clients` table.

## 2. Slide-Over Approval Panel

### Trigger

Client clicks a pending post card on the dashboard.

### Structure

- Panel slides in from the right, covering ~60% of viewport width
- Semi-transparent overlay dims the dashboard behind
- Close via X button or clicking overlay
- Auto-close on successful approve or skip. Stay open during regeneration (client reviews new version).
- URL does not change (no `/dashboard/posts/[id]` route)
- Selected post tracked via local state in `pending-posts.tsx`, not URL search params

### Layout (Desktop)

Two columns inside the panel:

**Left — Platform Preview:**
- Styled to resemble an Instagram or Facebook feed post
- Instagram: avatar, username, photo, caption with bold username (~80% fidelity, not pixel-perfect)
- Facebook: similar treatment (~80% fidelity — client cares about photo + caption, not chrome)
- Read-only — this is what the post will look like
- Photo pulled from `photos` table via `photoId`

**Right — Actions Panel:**
- Platform label + icon (e.g., "Instagram" with gradient dot)
- Scheduled date (e.g., "ma 12 mei") — shown here only, not in preview
- Editable caption textarea
  - Pre-filled with current content
  - Always editable (no toggle)
  - When modified: blue border (`#2563eb`), "bewerkt" indicator label
- Action buttons (stacked):
  1. **"Goedkeuren"** — primary, dark (`#1a1a1a`). Changes to **"Goedkeuren met aanpassingen"** when caption is edited.
  2. **"Wijzigingen aanvragen"** — secondary, outlined
  3. **"Overslaan"** — tertiary, text-only, muted

### Layout (Mobile)

Single column, stacked: preview on top, actions below. Same content, same buttons.

### Interaction States

**Default:**
- Caption textarea editable, buttons visible

**Caption Edited:**
- Textarea border turns blue (`#2563eb`)
- "bewerkt" label appears next to "Tekst" heading
- Primary button changes to "Goedkeuren met aanpassingen"

**Request Changes (inline expansion):**
- Client clicks "Wijzigingen aanvragen"
- Action buttons replaced by:
  - Label: "Wat wil je anders?"
  - Feedback textarea with placeholder: `Bijv. "Minder emoji's" of "Meer over de appeltaart"`
  - Minimum 10 characters required
  - Two buttons: "Opnieuw genereren" (primary) + "Annuleren" (secondary)
- "Annuleren" restores the original button set

**Regenerating:**
- After submitting feedback, show loading state
- Message: "Even geduld... We maken een nieuwe versie van je post."
- Honest timing — this calls the Claude API, takes a few seconds
- When complete: new post version replaces old in the panel, client reviews again

**Loading (initial):**
- Skeleton state while post data loads into the panel

## 3. Server Actions & State Transitions

### Approve

```
POST status: "draft" → "approved"
```

- Sets `approvedAt` to current timestamp
- Sets `publishAt` based on industry posting time (from `config.ts`)
- If caption was edited, updates `content` field with new text
- Optimistic UI: immediately move card from "Pending" to "Upcoming" on dashboard
- Respects locked-day protection (if day became locked between load and action, show error)
- Optimistic failure path: if server rejects (locked day race, network error), snap card back to Pending and show Dutch toast: "Kon niet goedkeuren, probeer opnieuw."

### Skip (Reject)

```
POST status: "draft" → "rejected"
```

- Sets `rejectedAt` to current timestamp
- Increments `rejectionCount`
- Card disappears from "Pending" section
- No regeneration triggered

### Request Changes (Regenerate)

```
POST status: "draft" → regeneration → new "draft" row
```

- Check `rejectionCount < MAX_REJECTIONS` (3 from config.ts)
- If at max: show message "Je hebt het maximum aantal wijzigingen bereikt. Neem contact op met Stefan."
- Otherwise:
  - Update the existing post row in place (same `id`, same row)
  - Call a new single-post regeneration function (not the full weekly pipeline)
  - Uses the writing phase only — no re-planning needed, just regenerate one caption
  - Pass client feedback + original post content as prompt context
  - Update `content` with new text, increment `rejectionCount`, update `updatedAt`
  - Note: `rejectionCount` lives on the post row, scoped per-post (not per-client or per-week)
  - Show new version in the panel for re-approval

### Server Actions (not API routes)

All mutations use Next.js server actions via `src/lib/posts/actions.ts`. Server actions pair naturally with optimistic UI and skip the JSON serialization round trip. No `/api/posts/[id]/*` routes needed.

- `approvePost(postId, content?)` — validates session, resolves clientId, checks ownership, updates status
- `rejectPost(postId)` — validates session, resolves clientId, checks ownership, marks rejected
- `regeneratePost(postId, feedback)` — validates session, resolves clientId, calls single-post regeneration, updates row in place

All actions filter by `clientId` — no exceptions.

## 4. Data Access

### New Repository Functions Needed

```typescript
// Get a single post by ID, filtered by clientId
getPostById(db, postId, clientId): Post | null

// Update post status to approved, with optional content change
approvePost(db, postId, clientId, content?: string): Post

// Update post status to rejected
rejectPost(db, postId, clientId): Post

// Regenerate a post in place (update content, increment rejectionCount)
regeneratePost(db, postId, clientId, newContent: string): Post
```

All functions enforce `clientId` filtering. No function operates without it.

### Existing Functions Used

- `getPostsByDateRange` — dashboard data loading
- `getLockedDays` — locked-day validation before approve
- `MAX_REJECTIONS` — regeneration limit check

## 5. Component Architecture

### Server Components

- `src/app/dashboard/page.tsx` — main dashboard, fetches posts, renders sections
- `src/app/dashboard/layout.tsx` — dashboard shell (header, sign-out)

### Client Components

- `src/components/dashboard/pending-posts.tsx` — card grid, handles click → open panel
- `src/components/dashboard/post-card.tsx` — individual pending post card
- `src/components/dashboard/upcoming-posts.tsx` — day chips section
- `src/components/dashboard/published-posts.tsx` — published list section
- `src/components/dashboard/post-slide-over.tsx` — the slide-over panel (overlay + panel)
- `src/components/dashboard/post-preview.tsx` — platform-styled post preview (IG/FB)
- `src/components/dashboard/post-actions.tsx` — actions panel (textarea, buttons, states)

### Shared

- `src/lib/posts/actions.ts` — server actions for approve/reject/regenerate (or API route handlers)

## 6. Visual Design

### Color Palette

- Background: `#fafafa` (light gray)
- Cards: `white` with `1px solid #e5e5e5` border
- Primary button: `#1a1a1a` (near-black)
- Text: `#1a1a1a` (primary), `#333` (body), `#888` (secondary), `#aaa` (muted)
- Pending badge: `#ef4444` (red)
- Approved/upcoming: `#f0fdf4` bg, `#bbf7d0` border, `#15803d` text (green family)
- Edit indicator: `#2563eb` (blue)
- Instagram badge: gradient `#f09433 → #bc1888`
- Facebook badge: `#1877f2`

### Typography

- Geist Sans (already loaded in layout.tsx)
- Section headers: 16px, weight 600
- Card body: 13px, line-height 1.4
- Labels: 10px uppercase, letter-spacing 0.5px, color `#888`
- Buttons: 13-14px, weight 500

### Spacing

- Page padding: 24px
- Section gap: 32px
- Card grid gap: 12px
- Card internal padding: 12px

### Responsive

- Desktop: 2-column card grid, split slide-over
- Mobile (<768px): 1-column card grid, slide-over goes full-width, preview stacks above actions

## 7. Testing

### E2E Verification Script

`scripts/e2e-approval-flow.ts` — walks the full flow:

1. Login via magic link (or seed authenticated session)
2. Load dashboard, verify pending posts appear
3. Open a pending post via slide-over
4. Edit caption, verify "bewerkt" indicator + button label change
5. Approve with edits, verify state change (post moves to "upcoming")
6. Open another pending post
7. Request changes with feedback, verify regeneration
8. Verify locked-day rejection path (try to approve a locked-day post)
9. No console errors throughout

Header comment documenting runtime and when to run. Registered in `package.json` scripts.

## 8. Out of Scope

- Meta API publishing (stub only)
- Real engagement metrics (placeholder "—")
- Multi-client switching (one client per session)
- Comments/threads on posts
- Rejection feedback loop (future feature, separate branch)
- Notification emails for pending approvals (future)

## 9. Definition of Done

- [ ] Client can log in via magic link and land on dashboard
- [ ] Dashboard shows pending, upcoming, and published sections with correct data
- [ ] Empty states render correctly in Dutch
- [ ] Clicking a pending post opens the slide-over panel
- [ ] Platform preview renders correctly for Instagram and Facebook
- [ ] Client can edit caption inline (blue border, label change, button change)
- [ ] Approve moves post to "approved" status, card moves to "Upcoming"
- [ ] Approve with edits saves the new caption
- [ ] "Overslaan" marks post as rejected, removes from pending
- [ ] "Wijzigingen aanvragen" shows feedback textarea inline
- [ ] Regeneration calls Claude API, replaces post, client re-approves
- [ ] MAX_REJECTIONS (3) enforced with Dutch error message
- [ ] Locked-day protection prevents invalid approvals
- [ ] All API routes filter by clientId
- [ ] Mobile responsive (stacked on small screens)
- [ ] No console errors
- [ ] E2E verification script passes
