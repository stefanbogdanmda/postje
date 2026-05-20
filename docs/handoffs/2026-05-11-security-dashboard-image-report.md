# 2026-05-11 Security, Dashboard, and Image Setup Report

## Summary

This report captures the work done on May 11, 2026 to harden the Postje app, fix post workflow bugs, add generated Cafe de Hoek images, and make those images visible in the local dashboard.

The main goals were:

- Audit the app for bugs, security issues, and production risks.
- Fix the highest-risk issues without breaking existing functionality.
- Generate Cafe de Hoek post images.
- Show those images in the dashboard.
- Start the local dev server for review.

## Review Findings Addressed

Two review agents plus a local review found the same major risks:

- Public API routes trusted caller-supplied `clientId`.
- `/admin/generate-preview` was a client-only page protected only by session-cookie presence.
- Magic-link login could allow unknown-email self-registration.
- Post regeneration could mutate non-draft posts.
- Approve/reject transitions were race-prone.
- Dashboard week range did not match the Tuesday-Monday generation cycle.
- `publishAt` was never set on approval.
- SQLite foreign keys were not explicitly enabled.
- Generation and regeneration used hardcoded Cafe de Hoek prompt data.
- Expensive AI/blob routes had weak rate limiting.
- Next 16 deprecated `middleware.ts` in favor of `proxy.ts`.

## Security and Authorization Changes

Added a shared authorization layer:

- `src/lib/authorization.ts`

It provides:

- `requireUser()`
- `requireAdmin()`
- `requireClientAccess()`
- `toErrorResponse()`

Protected these API routes:

- `src/app/api/generate-posts/route.ts`
- `src/app/api/posts/route.ts`
- `src/app/api/photos/upload/route.ts`
- `src/app/api/photos/[id]/analyze/route.ts`

Behavior now:

- Anonymous callers receive `401`.
- Clients can only access their own client data.
- Admins can pass an explicit `clientId`.
- Raw LLM/provider errors are no longer returned to the browser.

## Admin Preview Fix

Split `/admin/generate-preview` into:

- Server-gated page: `src/app/admin/generate-preview/page.tsx`
- Client UI: `src/app/admin/generate-preview/generate-preview-client.tsx`

The page now checks admin role on the server before rendering the interactive generation UI.

## Auth Fix

Updated `src/lib/auth.ts` so magic-link sign-in only succeeds for existing users.

Also updated `scripts/seed-admin.ts` to lowercase `ADMIN_EMAIL`, preventing mixed-case seeded admin emails from causing login problems.

## Next 16 Proxy Migration

Removed deprecated:

- `middleware.ts`

Added:

- `src/proxy.ts`

Important detail: because this repo uses `src/app`, the proxy file must live at `src/proxy.ts`. The production build confirms it is detected as `ƒ Proxy (Middleware)`.

## Post Workflow Fixes

Updated `src/lib/posts/repository.ts` and `src/lib/posts/actions.ts`.

Changes:

- Approve/reject updates now include `status = "draft"` in the update condition.
- Regeneration is blocked for non-draft posts.
- Regeneration no longer unlocks approved/published/failed posts.
- `publishAt` is set when approving posts.
- Industry post times now support partial matches, so `Café / lunchroom` maps to the `cafe` schedule.

## Date Range Fix

Updated `src/lib/posts/dates.ts` and `src/app/dashboard/page.tsx`.

Dashboard now uses the same Tuesday-Monday generation window as the post generation flow.

Added helpers:

- `getGenerationWeekStart()`
- `getGenerationWeekRange()`
- `formatLocalDate()`

## Database Hardening

Enabled SQLite foreign keys explicitly in:

- `src/db/index.ts`
- `src/test/db.ts`
- `scripts/seed-admin.ts`
- `scripts/seed-cafe-de-hoek.ts`
- `scripts/e2e-post-pipeline.ts`

Added a test proving deleting a user cascades to related client/photos/posts.

## Client Profile Fix

Added:

- `src/lib/ai/client-profile.ts`

Generation and regeneration now build a `ClientProfile` from the `clients` table instead of always using hardcoded Cafe de Hoek data.

Files updated:

- `src/app/api/generate-posts/route.ts`
- `src/lib/ai/regenerate-post.ts`

## Rate Limiting

Added:

- `src/lib/request-rate-limit.ts`

Extended:

- `src/lib/rate-limit.ts`

The expensive routes now have basic in-memory request throttling:

- post generation
- photo upload
- photo analysis

Note: this is good enough for local/simple deployment, but a production multi-instance deployment should use a shared store such as Redis/KV.

## Generated Cafe de Hoek Images

Generated three square social post images:

- Homemade apple pie with cappuccino
- Seasonal soup with bread
- Fresh sandwiches with juice

Copied into the project:

- `public/generated/cafe-de-hoek/apple-pie-cappuccino.png`
- `public/generated/cafe-de-hoek/soup-bread.png`
- `public/generated/cafe-de-hoek/sandwiches-juice.png`

Also registered them in local SQLite `photos` rows:

- `generated-apple-pie-cappuccino`
- `generated-soup-bread`
- `generated-sandwiches-juice`

Then attached them to draft Cafe de Hoek posts in the local database.

## Dashboard Image Rendering

Before this change, the dashboard only showed camera/text placeholders based on `photoId`.

Updated:

- `src/lib/posts/types.ts`
- `src/lib/posts/repository.ts`
- `src/components/dashboard/post-card.tsx`
- `src/components/dashboard/post-preview.tsx`

Post queries now include `photoUrl`, joined from the `photos` table. Dashboard cards and previews render actual images when `photoUrl` exists.

## E2E Script Update

Updated:

- `scripts/e2e-post-pipeline.ts`

Because the APIs are now authenticated, the script creates a temporary admin session in SQLite and sends the session cookie with API requests.

## Verification Performed

Successful checks after the fixes:

```bash
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:approval
```

Results:

- Lint: passed with zero warnings.
- Unit tests: 52/52 passed.
- Production build: passed.
- Approval flow e2e: 19/19 passed.
- Build output confirmed Next detected `ƒ Proxy (Middleware)`.

## Local Server

The local dev server was started outside the sandbox so it stays alive:

```text
http://127.0.0.1:3000/login
```

Verified:

- `/login` returned `HTTP 200`.
- Port `127.0.0.1:3000` was listening.

## Known Notes

- The current rate limiter is still in-memory. Use Redis/KV before serious production use.
- Generated images are local project assets, not Vercel Blob uploads.
- The local DB was modified to attach generated images to Cafe de Hoek posts.
- There were unrelated/untracked local files present:
  - `.claude/settings.local.json`
  - `.mcp.json`
- `package.json` / `package-lock.json` showed an unrelated `shadcn` dependency change already present in the working tree.

## Suggested Next Steps

- Review dashboard visually at `http://127.0.0.1:3000/login`.
- If the generated images look good, decide whether they should stay as local `public/` assets or be uploaded through the normal photo/blob flow.
- Add production-grade shared rate limiting.
- Consider adding route-handler authorization tests with mocked sessions.
