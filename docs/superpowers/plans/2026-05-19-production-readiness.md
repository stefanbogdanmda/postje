# Social AI — Production Readiness Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take Social AI from "happy path works" to "ready for the first paying client" — closing every critical, high-priority, and medium-priority gap identified in the 2026-05-18 production readiness report.

**Architecture:** Five sequential phases, each producing working, testable software. Phase 1 (security hardening) is fully detailed below. Phase 2 (publisher engine) is already detailed in `docs/superpowers/plans/2026-05-12-publisher-engine.md`. Phases 3-5 are scoped at task level and will be expanded into full plans when we reach them.

**Tech Stack:** TypeScript, Next.js App Router, Drizzle ORM (Neon Postgres), Vitest + PGlite, Vercel hosting.

**Baseline:** 318 tests passing across 26 files. Branch: `feat/publisher-engine` (12 commits ahead of main).

---

## Phase Overview

| Phase | Focus | Sessions | Depends On |
|-------|-------|----------|------------|
| **1** | Security hardening | 1-2 | Nothing |
| **2** | Publisher engine | 3-5 | Phase 1 merged |
| **3** | Client profiles + Attention Dashboard | 3-4 | Phase 2 merged |
| **4** | Infrastructure + testing | 2-3 | Phase 2 merged |
| **5** | Polish + launch prep | 2-3 | Phase 3+4 merged |

Phases 3 and 4 can run in parallel after Phase 2 lands.

---

# Phase 1: Security Hardening

**Goal:** Close the cheapest, highest-impact security gaps before any new features land. Every task is a single-file or two-file change.

**Branch:** `feat/security-hardening` (from current `feat/publisher-engine` tip, or from `main` if publisher merges first)

---

## File Structure

### New files

| Path | Responsibility |
|------|----------------|
| `src/middleware.ts` | Next.js middleware entry point — delegates to `proxy.ts` |
| `src/lib/cron-auth.ts` | Shared timing-safe cron secret verification |

### Modified files

| Path | Change |
|------|--------|
| `next.config.ts` | Add security headers |
| `src/app/api/cron/check-alerts/route.ts` | Replace `!==` with timing-safe check via `cron-auth.ts` |
| `src/app/api/cron/process-deletions/route.ts` | Same timing-safe fix |
| `src/app/api/posts/route.ts` | Add rate limiting |
| `src/app/api/meta/connect/start/route.ts` | Add rate limiting |
| `src/app/api/admin/delete-user/route.ts` | Add rate limiting |
| `src/app/api/account/deletion/cancel/route.ts` | Add rate limiting |
| `.env.example` | Ensure all env vars are listed |

---

### Task 1: Add security headers to `next.config.ts`

**What this does in plain English:** When someone's browser loads a page from Social AI, the server sends back invisible instructions called "headers" that tell the browser security rules — like "don't let other websites embed this page in a frame" or "only load scripts from trusted sources." Right now Social AI sends zero security headers.

**Files:**
- Modify: `next.config.ts`
- Test: manual verification via browser dev tools or `curl -I`

- [ ] **Step 1: Read the current `next.config.ts`**

Confirm it's the empty placeholder:
```typescript
import type { NextConfig } from "next";
const nextConfig: NextConfig = { /* config options here */ };
export default nextConfig;
```

- [ ] **Step 2: Add security headers**

Replace the entire file content with:

```typescript
import type { NextConfig } from "next"

const securityHeaders = [
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self'",
      "connect-src 'self' https:",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; "),
  },
]

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
```

**Why `'unsafe-inline'` and `'unsafe-eval'` for scripts:** Next.js injects inline scripts for hydration and React development mode uses `eval`. A nonce-based CSP is the ideal next step but requires custom `_document` or middleware changes — this is a significant improvement over no CSP at all.

- [ ] **Step 3: Verify the build still works**

Run: `npm run build`
Expected: success. No errors from the new config.

- [ ] **Step 4: Verify headers locally**

Run: `npm run dev` (in a separate terminal), then:
Run: `curl -sI http://localhost:3000/login | grep -i "x-frame\|content-security\|strict-transport\|x-content-type\|referrer-policy"`
Expected: all 5+ headers appear in the response.

- [ ] **Step 5: Commit**

```bash
git add next.config.ts
git commit -m "feat(security): add security headers — CSP, HSTS, X-Frame-Options, and more

Adds Content-Security-Policy, Strict-Transport-Security, X-Frame-Options
DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy,
and X-DNS-Prefetch-Control to all routes via next.config.ts headers()."
```

---

### Task 2: Create `src/middleware.ts` to wire up `proxy.ts`

**What this does in plain English:** `proxy.ts` already has the logic that checks "does this visitor have a login cookie?" and redirects unauthenticated visitors to the login page. But Next.js only runs that logic if there's a file called `middleware.ts` that calls it. Without `middleware.ts`, `proxy.ts` sits there doing nothing — every route has to check authentication on its own, and if someone forgets that check on a new page, it's wide open.

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 1: Create `src/middleware.ts`**

```typescript
export { proxy as middleware, config } from "./proxy"
```

That's it. One line. The proxy module already exports the function and the matcher config.

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: success. Middleware is listed in the build output.

- [ ] **Step 3: Quick manual test**

Run: `npm run dev`, then open an incognito browser and go to `http://localhost:3000/dashboard`.
Expected: redirected to `/login` (because there's no session cookie).

- [ ] **Step 4: Run all tests to confirm no regressions**

Run: `npm test`
Expected: 318 passing.

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(security): wire up auth middleware via proxy.ts

One-line middleware.ts that re-exports the proxy function and matcher
config. All /admin/*, /dashboard/*, /welcome/* routes now have
defense-in-depth session-cookie checks before hitting page-level auth."
```

---

### Task 3: Fix cron secret timing attack

**What this does in plain English:** The two cron jobs (check-alerts and process-deletions) verify a secret password before running. They currently compare that password using `!==` — JavaScript's normal "not equal" check. The problem: `!==` stops comparing as soon as it finds the first wrong character, and an attacker can measure that tiny time difference to guess the secret one character at a time. `crypto.timingSafeEqual()` always takes the same amount of time regardless of how many characters match, so it reveals nothing.

**Files:**
- Create: `src/lib/cron-auth.ts`
- Modify: `src/app/api/cron/check-alerts/route.ts`
- Modify: `src/app/api/cron/process-deletions/route.ts`

- [ ] **Step 1: Create the shared helper `src/lib/cron-auth.ts`**

```typescript
import { timingSafeEqual } from "node:crypto"

/**
 * Verify a cron request's Authorization header against CRON_SECRET.
 * Uses timing-safe comparison to prevent character-by-character guessing.
 * Returns { ok: true } or { ok: false, response: Response } with the
 * appropriate error response ready to return.
 */
export function verifyCronSecret(
  authHeader: string | null
): { ok: true } | { ok: false; response: Response } {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron] CRON_SECRET not configured — refusing to run")
    return { ok: false, response: new Response("Server misconfigured", { status: 500 }) }
  }

  const expected = `Bearer ${secret}`
  const actual = authHeader ?? ""

  // timingSafeEqual requires equal-length buffers. If lengths differ,
  // compare actual against itself (constant time) and then reject.
  const expectedBuf = Buffer.from(expected)
  const actualBuf = Buffer.from(actual)

  if (expectedBuf.length !== actualBuf.length) {
    // Still do a comparison to keep timing constant
    timingSafeEqual(expectedBuf, expectedBuf)
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) }
  }

  if (!timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) }
  }

  return { ok: true }
}
```

- [ ] **Step 2: Update `src/app/api/cron/check-alerts/route.ts`**

Find the existing auth block (around lines 40-48):
```typescript
const CRON_SECRET = process.env.CRON_SECRET
```
...and the `if (!CRON_SECRET)` + `if (authHeader !== ...)` checks.

Replace those lines with:
```typescript
import { verifyCronSecret } from "@/lib/cron-auth"
```
(at top of file)

And replace the inline auth check in the GET handler with:
```typescript
  const cronAuth = verifyCronSecret(authHeader)
  if (!cronAuth.ok) return cronAuth.response
```

Remove the `CRON_SECRET` constant and both old `if` blocks.

- [ ] **Step 3: Update `src/app/api/cron/process-deletions/route.ts`**

Same pattern: add `import { verifyCronSecret } from "@/lib/cron-auth"` at top, replace the inline auth block with:
```typescript
  const cronAuth = verifyCronSecret(authHeader)
  if (!cronAuth.ok) return cronAuth.response
```

Remove the `CRON_SECRET` constant and both old `if` blocks.

- [ ] **Step 4: Verify build + tests**

Run: `npm run build && npm test`
Expected: build succeeds, 318 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cron-auth.ts src/app/api/cron/check-alerts/route.ts src/app/api/cron/process-deletions/route.ts
git commit -m "fix(security): use timing-safe comparison for cron secret

Replaces !== string comparison with crypto.timingSafeEqual() to prevent
timing-based secret extraction. Shared verifyCronSecret() helper used
by both cron routes."
```

---

### Task 4: Add rate limiting to unprotected API routes

**What this does in plain English:** Rate limiting is like a bouncer counting how many times someone knocks on the door. If someone knocks too fast (like a bot trying to spam or brute-force), the bouncer says "slow down." Several API routes currently have no bouncer at all.

**Files:**
- Modify: `src/app/api/posts/route.ts`
- Modify: `src/app/api/admin/delete-user/route.ts`
- Modify: `src/app/api/account/deletion/cancel/route.ts`
- Modify: `src/app/api/meta/connect/start/route.ts`

First, check how the existing rate limiter works so we match the pattern.

- [ ] **Step 1: Read the existing rate limiter**

Read `src/lib/rate-limit.ts` to understand the API. It should export a function like `checkRateLimit(db, key, opts)` that returns whether the request is allowed.

- [ ] **Step 2: Add rate limiting to `src/app/api/posts/route.ts`**

At the top, import the rate limiter. Inside the POST handler, before any business logic:

```typescript
import { checkRateLimit } from "@/lib/rate-limit"
import { db } from "@/db"

// Inside POST handler, after auth check:
const rateLimit = await checkRateLimit(db, `posts:${session.user.id}`, {
  maxRequests: 10,
  windowMs: 60_000,
})
if (!rateLimit.allowed) {
  return Response.json(
    { error: "Te veel verzoeken. Probeer het over een minuut opnieuw." },
    { status: 429 }
  )
}
```

- [ ] **Step 3: Add rate limiting to `src/app/api/admin/delete-user/route.ts`**

Same pattern, key: `delete-user:${session.user.id}`, maxRequests: 5, windowMs: 60_000.

- [ ] **Step 4: Add rate limiting to `src/app/api/account/deletion/cancel/route.ts`**

Key: `deletion-cancel:${ip}` (extract IP from request headers), maxRequests: 10, windowMs: 60_000.

- [ ] **Step 5: Add rate limiting to `src/app/api/meta/connect/start/route.ts`**

Key: `meta-connect:${session.user.id}`, maxRequests: 5, windowMs: 60_000.

- [ ] **Step 6: Verify build + tests**

Run: `npm run build && npm test`
Expected: build succeeds, 318 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/posts/route.ts src/app/api/admin/delete-user/route.ts src/app/api/account/deletion/cancel/route.ts src/app/api/meta/connect/start/route.ts
git commit -m "feat(security): add rate limiting to unprotected API routes

Adds rate limiting to /api/posts, /api/admin/delete-user,
/api/account/deletion/cancel, and /api/meta/connect/start using
the existing database-backed rate limiter."
```

---

### Task 5: Verify `.env.example` is complete

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Read the current `.env.example`**

- [ ] **Step 2: Grep for all `process.env.` references in the codebase**

Run: `grep -roh "process\.env\.\w\+" src/ --include="*.ts" --include="*.tsx" | sort -u`

- [ ] **Step 3: Cross-check and add any missing variables**

Ensure every variable from the grep output appears in `.env.example` with a placeholder value and a comment explaining what it's for. Expected variables:

```
DATABASE_URL=postgresql://user:password@host:5432/dbname
AUTH_SECRET=generate-a-random-32-char-string
AUTH_RESEND_KEY=re_your_resend_api_key
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
CRON_SECRET=generate-a-random-string-for-cron-auth
META_APP_ID=your-meta-app-id
META_APP_SECRET=your-meta-app-secret
META_TOKEN_ENCRYPTION_KEY=base64-encoded-32-byte-key
META_GRAPH_VERSION=v21.0
ADMIN_EMAIL=stefan@yourdomain.com
BLOB_READ_WRITE_TOKEN=vercel-blob-token
```

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "chore: ensure .env.example lists all required environment variables"
```

---

### Task 6: Phase 1 final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: 318+ tests pass.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: success. Middleware shows in build output.

- [ ] **Step 5: Commit any remaining changes, push**

```bash
git push -u origin feat/security-hardening
```

---

# Phase 2: Publisher Engine

**Detailed plan:** `docs/superpowers/plans/2026-05-12-publisher-engine.md` (13 tasks)

**Summary:** This phase implements the core value loop — publishing approved posts to Facebook and Instagram via the Meta Graph API.

Key deliverables:
- `publish_attempts` table for audit trail
- Shared Meta HTTP boundary (`client.ts`)
- Error classification for Meta API responses
- Facebook publish (feed + photos)
- Instagram publish (two-step container/publish)
- `publishPostToMeta` orchestrator with transaction-safe state updates
- Queue repository (`findQueuePosts`, `resetFailedPostToApproved`)
- Server actions for publish-now and retry-failed
- `/admin/queue` page with publish/retry buttons

**Blocker check before starting Phase 2:** The Meta "App not active" error must be resolved. Two paths:
1. **Preferred:** Fill Meta compliance fields (app icon, privacy policy URL, terms URL, data deletion URL), then retry OAuth
2. **Fallback:** Evaluate Ayrshare intermediary API (~$99/mo) — rewrites scope is small since `src/lib/meta/` is isolated

**Decision needed from Stefan:** Manual publishing (operator clicks "Publish now" per post — recommended) vs. automatic cron-based publishing. The existing plan implements manual. If Stefan chooses auto or hybrid, the plan needs an addendum for the cron route.

---

# Phase 3: Client Profiles + Attention Dashboard

> Full task-level detail will be written when we reach this phase. Scope below.

### Task 3.1: Add brand profile columns to `clients` table

**Schema additions:**
- `timezone` (text, default `"Europe/Amsterdam"`) — fixes the publishAt timezone bug
- `toneOfVoice` (text, nullable) — extracted from kickoff call
- `targetCustomers` (text, nullable)
- `brandPersonality` (text, nullable)
- `bannedPhrases` (jsonb, default `[]`) — per-client list that grows over time
- `examplePosts` (jsonb, default `[]`) — real posts for AI to imitate
- `calibrationStartDate` (timestamp, nullable) — when calibration period began
- `publishMode` (text enum: `"manual"` | `"auto"`, default `"manual"`)

New migration. Tests to verify column defaults.

### Task 3.2: Fix publishAt timezone bug

Use `timezone` column from 3.1. Update `buildPublishAt()` to construct dates in the client's timezone instead of UTC. Test with Amsterdam vs UTC.

### Task 3.3: Make AI prompt generation read from database

Replace hardcoded Cafe de Hoek profile with dynamic client profile lookup. The `generatePosts` function should load `toneOfVoice`, `bannedPhrases`, `examplePosts`, `targetCustomers` from the `clients` row.

### Task 3.4: Banned phrases management UI

Admin page at `/admin/clients/[id]/phrases` or inline on the client detail page. Add/remove banned phrases per client. Server action updates the jsonb column.

### Task 3.5: Build Stefan's Attention Dashboard

Server component at `/admin/attention` showing:
- Clients who hit rejection limits (3+ rejections on a single post)
- Clients in calibration period (first 2 weeks)
- Clients past 24-hour approval window
- Posts flagged by clients
- Posts that failed publishing (cross-link to `/admin/queue`)

Each section is a database query. No charts — just actionable lists.

### Task 3.6: Add flag button on published posts (client view)

Client dashboard shows a flag icon on published posts. Clicking it creates a `post_flags` row and sends an alert email to Stefan. New table `post_flags` with `postId`, `clientId`, `reason`, `flaggedAt`.

### Task 3.7: Add cancel button on approved-but-unpublished posts

Client dashboard shows a cancel button on approved posts that haven't published yet. Clicking it reverts status to `draft` or `cancelled`. Server action with status guard.

---

# Phase 4: Infrastructure + Testing

> Can run in parallel with Phase 3 after Phase 2 merges.

### Task 4.1: Add Zod input validation to all API routes

Install `zod`. Create schemas for every API route's request body. Replace bare `request.json() as X` with `schema.parse()`. Error responses include validation details.

Routes to cover:
- `/api/posts` (POST)
- `/api/photos/upload` (POST)
- `/api/photos/[id]/analyze` (POST)
- `/api/generate-posts` (POST)
- `/api/admin/delete-user` (POST)
- `/api/account/deletion/cancel` (GET — query params)
- `/api/meta/connect/start` (POST)

### Task 4.2: Separate dev and prod databases

Configure a Neon branch for development. Update CLAUDE.md and `.env.example` to document the split. Add a check to `src/lib/env.ts` that warns if `DATABASE_URL` points to production while `NODE_ENV=development`.

### Task 4.3: Install test coverage tooling

Add `@vitest/coverage-v8`. Configure 80% threshold in `vitest.config.ts`. Run coverage report and document the baseline.

### Task 4.4: Test `lib/authorization.ts`

Security-critical code with zero coverage. Write tests for `requireClientAccess()`, `requireAdmin()`, and any other authorization helpers. Test both allowed and denied paths.

### Task 4.5: Test untested API route handlers

Add integration tests for routes that currently lack them:
- `/api/posts`
- `/api/generate-posts`
- `/api/admin/delete-user`
- `/api/account/deletion/cancel`
- `/api/photos/upload`

### Task 4.6: Switch photos to private blob storage

Change Vercel Blob uploads from `access: "public"` to `access: "private"`. Add signed URL generation. Update all photo display code to use signed URLs.

### Task 4.7: Add Meta token refresh logic

Long-lived tokens expire after ~60 days. Add a cron job or periodic check that refreshes tokens before expiry. Update `meta_connections.expiresAt`. Alert Stefan when a refresh fails.

---

# Phase 5: Polish + Launch Prep

### Task 5.1: Add `loading.tsx` for all route groups

Create `src/app/dashboard/loading.tsx`, `src/app/admin/loading.tsx`, and `src/app/login/loading.tsx` with simple skeleton UIs. Prevents blank screens during SSR.

### Task 5.2: Add `error.tsx` for all route groups

Create `src/app/dashboard/error.tsx` and `src/app/admin/error.tsx` with user-friendly error boundaries. Never show raw Next.js error pages to clients.

### Task 5.3: Fix admin CSS — define `--admin-*` variables

Create `src/styles/admin-tokens.css` (or add to an existing global stylesheet) with all `--admin-*` custom properties used in admin components. Import it in the admin layout.

### Task 5.4: Add navigation to `/dashboard/account`

Add a link to the account page from the dashboard layout or navigation. GDPR features exist but are currently unreachable.

### Task 5.5: Fix PostSlideOver accessibility

Add `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, and focus trapping to the post detail slide-over component.

### Task 5.6: Make admin pages responsive

Add responsive breakpoints to admin layouts. Mobile-first approach. Key pages: client list, client detail, queue, attention dashboard.

### Task 5.7: Add health check endpoint

Create `/api/health` that verifies database connectivity and returns `{ status: "ok", timestamp }`. Register for uptime monitoring.

### Task 5.8: Add Sentry error monitoring

Install `@sentry/nextjs`. Configure for production only. Replace `console.error` calls with proper Sentry captures. Verify errors appear in Sentry dashboard.

### Task 5.9: Final E2E smoke test

Write Playwright tests covering:
1. Login with magic link
2. View dashboard, approve a post
3. Admin: create client, view queue
4. Account deletion flow

---

## Decisions Needed Before Proceeding

Before we start executing, three decisions from Stefan:

1. **Meta blocker resolution** — Fill compliance fields and retry OAuth, or evaluate Ayrshare? (Blocks Phase 2)
2. **Publishing model** — Manual publish-from-queue (recommended, what Plan #5b implements) or automatic cron? (Affects Phase 2 scope)
3. **Attention Dashboard aesthetic** — Operator Console (dense, terminal-adjacent), Editorial Brief (magazine-style), or Bento Dashboard (tile grid)? (Affects Phase 3 scope)

**Recommendation:** Start Phase 1 now (no blockers), make decisions 1-3 during Phase 1, then flow into Phase 2.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-19-production-readiness.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
