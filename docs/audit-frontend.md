# Frontend Pages, Components & UX Audit

**Auditor:** Builder 4
**Date:** 2026-05-18
**Scope:** All pages under `src/app/`, all components under `src/components/`, CSS/design tokens, layout structure, accessibility, responsiveness, and UX completeness.

---

## 1. Inventory

### Pages (11 total)

| Route | File | Type | Purpose |
|-------|------|------|---------|
| `/` | `src/app/page.tsx` | Server | Router — redirects to `/login`, `/welcome`, `/admin`, or `/dashboard` |
| `/login` | `src/app/login/page.tsx` | Client | Magic link login form |
| `/welcome` | `src/app/welcome/page.tsx` | Server | First-login greeting for new clients |
| `/dashboard` | `src/app/dashboard/page.tsx` | Server | Client dashboard — pending, upcoming, published posts |
| `/dashboard/account` | `src/app/dashboard/account/page.tsx` | Server | GDPR account page — export data, delete account |
| `/account/deletion/cancelled` | `src/app/account/deletion/cancelled/page.tsx` | Server | Deletion cancellation confirmation |
| `/admin` | `src/app/admin/page.tsx` | Server | Admin user list with delete capability |
| `/admin/clients` | `src/app/admin/clients/page.tsx` | Server | Client list with status indicators |
| `/admin/clients/new` | `src/app/admin/clients/new/page.tsx` | Client | New client creation form |
| `/admin/clients/[id]` | `src/app/admin/clients/[id]/page.tsx` | Server | Client detail — edit form + Meta connection panel |
| `/admin/generate-preview` | `src/app/admin/generate-preview/page.tsx` | Server | AI post generation preview (hardcoded to Cafe de Hoek) |

### Layouts (2)

| Layout | File | Purpose |
|--------|------|---------|
| Root | `src/app/layout.tsx` | Fonts (Geist Sans, Geist Mono, DM Serif Display), providers, `lang="nl"` |
| Dashboard | `src/app/dashboard/layout.tsx` | Client header bar, business name, sign-out, max-w-4xl content area |

### Components (13 total)

| Component | File | Client/Server |
|-----------|------|---------------|
| `SignOutButton` | `src/components/sign-out-button.tsx` | Client |
| `SuccessBanner` | `src/components/success-banner.tsx` | Client |
| `PendingPosts` | `src/components/dashboard/pending-posts.tsx` | Client |
| `PostCard` | `src/components/dashboard/post-card.tsx` | Server |
| `PostSlideOver` | `src/components/dashboard/post-slide-over.tsx` | Client |
| `PostPreview` | `src/components/dashboard/post-preview.tsx` | Server |
| `PostActions` | `src/components/dashboard/post-actions.tsx` | Client |
| `UpcomingPosts` | `src/components/dashboard/upcoming-posts.tsx` | Server |
| `PublishedPosts` | `src/components/dashboard/published-posts.tsx` | Server |
| `DeleteAccountButton` | `src/components/dashboard/delete-account-button.tsx` | Client |
| `ExportDataButton` | `src/components/dashboard/export-data-button.tsx` | Client |
| `PendingDeletionBanner` | `src/components/dashboard/pending-deletion-banner.tsx` | Client |
| `MetaConnectionPanel` | `src/components/admin/meta-connection-panel.tsx` | Client |

### Server Actions (4 files)

| File | Actions |
|------|---------|
| `src/app/admin/clients/actions.ts` | `createClient`, `updateClient` |
| `src/app/admin/clients/[id]/meta-actions.ts` | `getMetaConnectUrlAction`, `disconnectMetaAction` |
| `src/app/dashboard/account/actions.ts` | `exportMyDataAction`, `requestAccountDeletionAction`, `cancelAccountDeletionAction`, `getActiveDeletionRequestAction` |
| `src/lib/posts/actions.ts` | `approvePostAction`, `rejectPostAction`, `regeneratePostAction` |

---

## 2. Design System & Styling

### Current State

The project uses **Tailwind CSS v4** with CSS custom properties defined in `globals.css`. The dashboard components use a warm neutral palette via design tokens.

**Design tokens defined:**
- Surface colors: `--surface-bg`, `--surface-card`, `--surface-muted`
- Text hierarchy: `--text-primary`, `--text-secondary`, `--text-muted`
- Accent colors: `--accent-approve`, `--accent-pending`, `--accent-edit`
- Borders: `--border-light`, `--border-medium`
- Shadows: `--shadow-card`, `--shadow-elevated`
- Easing: `--ease-out-expo`
- Approved tints: `--approved-bg`, `--approved-border`, `--approved-text`

**Typography:**
- Three fonts loaded: Geist Sans, Geist Mono, DM Serif Display
- `--font-display` used for section headings in dashboard
- Body falls back to `Arial, Helvetica, sans-serif`

**Animations (3):**
- `slide-in` — slide-over panel entrance
- `fade-overlay` — backdrop fade
- `card-appear` — staggered card reveal

### Findings

| ID | Severity | Finding |
|----|----------|---------|
| DS-1 | **HIGH** | **Mixed styling approach.** Dashboard components use Tailwind + CSS custom properties (good), but admin pages and account pages use **inline `style={{}}` objects** throughout. This creates two parallel styling systems, making the UI inconsistent and hard to maintain. |
| DS-2 | **MEDIUM** | **No shadcn/ui components used.** `shadcn` is in devDependencies but no `src/components/ui/` directory exists. All form inputs, buttons, dialogs, and tables are hand-styled with inline styles or raw Tailwind. This leads to duplicated styling logic (e.g., `inputStyle` and `labelStyle` objects copied between `new/page.tsx` and `edit-client-form.tsx`). |
| DS-3 | **MEDIUM** | **Dark mode tokens incomplete.** `globals.css` defines dark mode overrides for `--background` and `--foreground` only, but none of the dashboard design tokens (surface, text, border, accent) have dark mode variants. If `prefers-color-scheme: dark` activates, the dashboard will have a dark body background with light-themed cards — visual breakage. |
| DS-4 | **MEDIUM** | **Admin pages have no design tokens.** The `MetaConnectionPanel` uses CSS variables like `--admin-border`, `--admin-surface`, `--admin-text`, etc. — but these are **never defined** anywhere in `globals.css`. This likely means the admin panel renders with broken/missing styles unless a browser provides defaults. |
| DS-5 | **LOW** | **`formatDutchDate` duplicated 3 times.** Identical implementations exist in `post-card.tsx`, `post-actions.tsx`, `upcoming-posts.tsx`, and `published-posts.tsx`. Should be extracted to a shared utility. |

---

## 3. Accessibility Audit

| ID | Severity | Finding |
|----|----------|---------|
| A11Y-1 | **CRITICAL** | **Login page has no skip-to-content link, no landmark roles.** The login form uses raw `<main>` with inline styles but no ARIA attributes. Screen readers cannot navigate efficiently. |
| A11Y-2 | **CRITICAL** | **PostSlideOver lacks proper dialog/modal ARIA.** The slide-over panel does not use `role="dialog"`, `aria-modal="true"`, or `aria-labelledby`. Focus is not trapped inside the panel. Clicking Escape closes it (good), but keyboard users can Tab outside the panel to elements behind the overlay. |
| A11Y-3 | **HIGH** | **Admin table has no `scope` attributes on `<th>` elements.** The users table on `/admin` and clients table on `/admin/clients` lack `scope="col"` on headers, making them harder for screen readers to interpret. |
| A11Y-4 | **HIGH** | **Delete confirmation dialog (`<dialog>`) has no `aria-labelledby` or `aria-describedby`.** The native `<dialog>` element in `DeleteAccountButton` is better than a div-based modal, but it needs descriptive ARIA references for screen readers. |
| A11Y-5 | **HIGH** | **Toast notification is not announced to screen readers.** The toast in `PendingPosts` uses a `<div>` with no `role="alert"` or `aria-live="polite"`. Sighted users see it, screen reader users don't. |
| A11Y-6 | **MEDIUM** | **Color contrast concerns.** `--text-muted` (#a39b91) on `--surface-bg` (#f8f6f3) yields approximately 2.5:1 contrast — fails WCAG AA for normal text (requires 4.5:1). Used extensively for secondary labels. |
| A11Y-7 | **MEDIUM** | **Buttons use inline styles with no focus-visible indicator.** Admin pages use `style={{}}` buttons with no `:focus-visible` or `outline` style. Keyboard users cannot see which element is focused. |
| A11Y-8 | **LOW** | **Images use `alt=""` (decorative).** Post photos use empty alt text — correct if decorative, but the Instagram/Facebook previews show user-submitted content photos that may benefit from descriptive alt text when available. |

---

## 4. Responsiveness & Layout

| ID | Severity | Finding |
|----|----------|---------|
| R-1 | **HIGH** | **Admin pages have no responsive design.** All admin pages (`/admin`, `/admin/clients`, `/admin/clients/new`, `/admin/clients/[id]`) use fixed `maxWidth` and `padding` inline styles with no breakpoints. The users table, client cards, and forms do not adapt to mobile viewports. |
| R-2 | **HIGH** | **No viewport meta tag explicitly set.** Next.js adds one by default, but this should be verified in production. No `<meta name="viewport">` found in layout.tsx (Next.js handles it). |
| R-3 | **MEDIUM** | **Dashboard is reasonably responsive.** The dashboard layout uses `max-w-4xl` with `px-6`, and post cards use `grid-cols-1 sm:grid-cols-2`. The slide-over uses `w-full sm:w-[60%]`. This is adequate but could benefit from breakpoint testing at 320px and 375px. |
| R-4 | **MEDIUM** | **Upcoming posts horizontal scroll has no scroll indicators.** The `overflow-x-auto` on the upcoming posts chip row gives no visual cue that more content is scrollable on mobile. |
| R-5 | **LOW** | **Login/welcome pages center vertically, which can push content off-screen on very small viewports.** The `minHeight: "100vh"` + flexbox centering may cause the form to be partially hidden on phones with on-screen keyboards. |

---

## 5. UX Flow Analysis

### Client Journey

| Step | Status | Notes |
|------|--------|-------|
| 1. Receive magic link email | BUILT | Welcome email + magic link sent on client creation |
| 2. Click link → lands on `/` | BUILT | First-login detection redirects to `/welcome` |
| 3. Welcome page → CTA to dashboard | BUILT | Simple, clear |
| 4. Dashboard — review pending posts | BUILT | Card grid → slide-over → approve/reject/request changes |
| 5. Edit post caption before approving | BUILT | Textarea with "bewerkt" indicator |
| 6. Request AI regeneration with feedback | BUILT | Feedback form, min 10 chars, max 3 rejections |
| 7. View approved (upcoming) posts | BUILT | Horizontal chip timeline |
| 8. View published posts | BUILT | List with metrics stub ("— likes") |
| 9. Export personal data (GDPR) | BUILT | JSON download |
| 10. Request account deletion | BUILT | 24-hour grace period, cancellation flow |
| 11. Navigate to account page | **MISSING** | No navigation link from dashboard to `/dashboard/account`. The account page exists but is unreachable from the UI unless the user types the URL manually. |

### Admin Journey

| Step | Status | Notes |
|------|--------|-------|
| 1. Admin login → `/admin` | BUILT | Role-based redirect |
| 2. View all users | BUILT | Table with email, role, login status |
| 3. Delete a user | BUILT | Email-confirmation dialog |
| 4. Navigate to clients | BUILT | Link at bottom of admin page |
| 5. View client list | BUILT | Cards with Active/Invited status |
| 6. Create new client | BUILT | Form with welcome email sending |
| 7. Edit client profile | BUILT | Pre-filled form |
| 8. Connect Meta (FB/IG) | BUILT | OAuth flow with connect/disconnect |
| 9. Generate post preview | BUILT | Hardcoded to Cafe de Hoek client |
| 10. View flagged posts | **MISSING** | Spec requires "attention list" — clients who hit rejection limits, missed 24-hour approval window, flagged posts. None of this is surfaced in the admin UI. |
| 11. Calibration spot-check | **MISSING** | Spec requires Stefan to review posts during first 2 weeks of each client. No UI for this. |
| 12. Client status overview | **MISSING** | No aggregate view of which clients are healthy, which need attention. |

---

## 6. Missing Features (Spec vs. Implementation)

| ID | Feature (from spec) | Status | Priority |
|----|---------------------|--------|----------|
| MF-1 | **Client flag button on published posts** | MISSING | HIGH — spec says "flag button on every published post" to alert Stefan |
| MF-2 | **Cancel button on approved-but-not-yet-published posts** | MISSING | HIGH — spec says clients should be able to cancel before publish |
| MF-3 | **Stefan's attention dashboard** | MISSING | HIGH — the spec's #1 admin priority: rejection limits, approval timeouts, flagged posts, calibration checks |
| MF-4 | **Navigation to account page** | MISSING | HIGH — `/dashboard/account` exists but no link in the dashboard layout header |
| MF-5 | **Post generation trigger for all clients** | PARTIAL | Admin generate-preview is hardcoded to one client (`CAFE_DE_HOEK_CLIENT_ID`). No UI to generate posts for any client or trigger batch generation. |
| MF-6 | **Client onboarding kickoff call integration** | NOT STARTED | MEDIUM — spec mentions recorded call transcription, profile extraction. No UI for this yet. |
| MF-7 | **Banned phrases management** | NOT STARTED | MEDIUM — spec says per-client banned phrases list that grows over time. No UI. |
| MF-8 | **Publishing status/error display** | PARTIAL | Posts have `publishError` field but no UI shows publish failures to admin or client. |
| MF-9 | **24-hour approval reminder notification** | BACKEND ONLY | Cron job exists (`/api/cron/check-alerts`) but no in-dashboard notification for Stefan. |
| MF-10 | **No middleware for route protection** | MISSING | All auth checks are per-page `auth()` calls. No middleware.ts to protect routes globally — unauthenticated users briefly see page content before redirect. |

---

## 7. Code Quality Issues

| ID | Severity | Finding |
|----|----------|---------|
| CQ-1 | **HIGH** | **No loading states for server pages.** Dashboard page, admin pages, and client detail pages make database calls before rendering. No `loading.tsx` files exist anywhere, so users see a blank screen during SSR. Next.js supports `loading.tsx` for streaming. |
| CQ-2 | **HIGH** | **No error boundaries.** No `error.tsx` or `not-found.tsx` files (except the implicit 404 from Next.js). If a database query fails, users see the default Next.js error page. |
| CQ-3 | **HIGH** | **`DeleteUserButton` uses raw `fetch()` instead of a server action.** Posts to `/api/admin/delete-user` with `JSON.stringify`. Inconsistent with the rest of the app which uses server actions. |
| CQ-4 | **MEDIUM** | **Post preview hardcodes "cafedehoek" and "Cafe de Hoek".** The Instagram and Facebook preview components in `post-preview.tsx` hardcode the business name and username. These should come from the client profile data. |
| CQ-5 | **MEDIUM** | **Generate preview page hardcoded to one client.** `CAFE_DE_HOEK_CLIENT_ID` is imported directly. Should accept a client selector or use a URL parameter. |
| CQ-6 | **MEDIUM** | **Admin pages fetch `allUsers` with `db.select().from(users)` — no pagination.** As user count grows, this will load all users into memory. Should add pagination early. |
| CQ-7 | **LOW** | **`console.error` statements in server actions.** `exportMyDataAction` and `requestAccountDeletionAction` use `console.error`. These should use a structured logger for production. |
| CQ-8 | **LOW** | **Admin page language inconsistency.** Client dashboard is in Dutch (nl), admin pages are in English. The spec says `lang="nl"` on `<html>`, but admin content is English. Should be consistent. |

---

## 8. Security (Frontend-Specific)

| ID | Severity | Finding |
|----|----------|---------|
| SEC-1 | **HIGH** | **No CSRF protection on the raw fetch in `DeleteUserButton`.** The `fetch("/api/admin/delete-user", { method: "POST" })` call doesn't include a CSRF token. Server actions have built-in CSRF protection via Next.js, but raw API routes do not. |
| SEC-2 | **MEDIUM** | **Success message reflected from URL parameters.** `/admin/clients` reads `searchParams.success` and renders it directly in `<SuccessBanner message={successMessage} />`. While React auto-escapes, this pattern could be fragile if the banner component ever uses `dangerouslySetInnerHTML`. |
| SEC-3 | **MEDIUM** | **`img` tags use `src={post.photoUrl}` without domain allow-listing.** The `<img>` elements accept any URL from the database. If a photo URL is ever compromised, it could load tracking pixels or offensive content. Next.js `<Image>` with `remotePatterns` config would mitigate this. |
| SEC-4 | **LOW** | **Export data downloads JSON blob without sanitization.** The `ExportDataButton` creates a Blob from server-returned JSON. The JSON is server-generated so risk is low, but the download filename includes the client ID which is a UUID (acceptable). |

---

## 9. Performance

| ID | Severity | Finding |
|----|----------|---------|
| PERF-1 | **MEDIUM** | **No image optimization.** All images use raw `<img>` tags instead of Next.js `<Image>`. This means no automatic resizing, format conversion (WebP/AVIF), or lazy loading optimization. Post photos could be large uploads served at full resolution. |
| PERF-2 | **MEDIUM** | **Dashboard page makes 3+ sequential database queries.** The dashboard page calls `auth()`, then queries `clients`, then `getPostsByDateRange`, then `markPostsAsSeen`, then `getActiveDeletionRequest`. Some of these could be parallelized. |
| PERF-3 | **LOW** | **Three web fonts loaded.** Geist Sans, Geist Mono, and DM Serif Display. Geist Mono is loaded but never referenced in any component — only in the CSS variable. Consider removing if unused. |
| PERF-4 | **LOW** | **No `Suspense` boundaries for streaming.** Server components that make DB calls could benefit from Suspense boundaries to show partial UI while data loads. |

---

## 10. Production Readiness Summary

### Blockers (Must Fix Before Launch)

1. **Missing navigation to `/dashboard/account`** — GDPR features exist but are unreachable from the UI
2. **PostSlideOver missing dialog ARIA** — accessibility barrier for keyboard/screen reader users
3. **Admin `--admin-*` CSS variables undefined** — MetaConnectionPanel likely renders with broken styles
4. **No `loading.tsx` or `error.tsx` files** — users see blank screens or raw error pages
5. **No middleware for route protection** — flash of unauthenticated content possible

### High Priority (Should Fix Before Launch)

6. Mixed inline styles vs Tailwind — creates maintenance burden and inconsistent UI
7. Admin pages not responsive — unusable on mobile/tablet
8. Missing attention dashboard for Stefan — core spec requirement
9. Flag/cancel buttons on posts — core spec requirement
10. Toast notifications not screen-reader accessible
11. CSRF on raw fetch endpoints

### Should Plan For (v1.1)

12. Adopt shadcn/ui for consistent form controls, buttons, dialogs
13. Use Next.js `<Image>` for photo optimization
14. Add pagination to admin user/client lists
15. Extract `formatDutchDate` to shared utility
16. Dark mode token completion or explicit removal of dark media query
17. Hardcoded business name in post previews → dynamic from client data
18. Generate-preview page → support any client

---

*End of audit.*
