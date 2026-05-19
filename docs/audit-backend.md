# Backend & API Routes Audit — Production Readiness

> **Date:** 2026-05-18
> **Scope:** All API routes, server actions, backend logic, middleware/proxy, cron jobs, and supporting library modules.
> **Auditor:** Builder 3 (Swarm Agent)

---

## Executive Summary

The backend is **well-structured for a v1 product** with solid fundamentals: authorization checks on every route, parameterized queries via Drizzle (no SQL injection risk), encrypted token storage, rate limiting, and transactional data operations. However, several **critical gaps** block a confident production launch, and a number of medium-priority items should be addressed before onboarding real paying clients.

### Verdict: **Not yet production-ready** — needs 8–12 focused work sessions to close the gaps below.

---

## 1. API Route Inventory

| Route | Method | Auth | Rate Limit | Purpose |
|-------|--------|------|------------|---------|
| `/api/auth/[...nextauth]` | GET, POST | Public (Auth.js) | Magic-link throttle | Authentication (magic links) |
| `/api/generate-posts` | POST | Client/Admin | 5 req / 15 min | AI content generation |
| `/api/posts` | GET | Client/Admin | None | Fetch posts by date range |
| `/api/photos/upload` | POST | Client/Admin | 20 req / 15 min | Upload photo to Vercel Blob |
| `/api/photos/[id]/analyze` | POST | Client/Admin | 20 req / 15 min | Re-analyze a photo via Claude |
| `/api/admin/delete-user` | POST | Admin only | None | Hard-delete a user account |
| `/api/account/deletion/cancel` | GET | Public (token-based) | None | Cancel deletion via email link |
| `/api/cron/check-alerts` | GET | CRON_SECRET bearer | N/A | Stale post + regen limit alerts |
| `/api/cron/process-deletions` | GET | CRON_SECRET bearer | N/A | Execute due account deletions |
| `/api/meta/connect/start` | GET | Admin only | None | Start Meta OAuth flow |
| `/api/meta/callback` | GET | Admin only | None | Complete Meta OAuth callback |

### Server Actions (Next.js `"use server"`)

| File | Actions | Auth |
|------|---------|------|
| `src/lib/posts/actions.ts` | `approvePostAction`, `rejectPostAction`, `regeneratePostAction` | Session → client lookup |
| `src/app/admin/clients/actions.ts` | `createClient`, `updateClient` | Admin session check |
| `src/app/dashboard/account/actions.ts` | `exportMyDataAction`, `requestAccountDeletionAction`, `cancelAccountDeletionAction`, `getActiveDeletionRequestAction` | Session check |

---

## 2. Critical Issues (Must Fix Before Launch)

### 2.1 No Publisher Engine — Posts Cannot Be Published

**Severity: CRITICAL**

The entire publishing pipeline is missing. Posts can be generated, reviewed, approved — but there is no code to actually publish them to Instagram or Facebook via the Meta Graph API. The `publishAt` timestamp is set on approval, but nothing ever reads it.

**What's needed:**
- A cron job or queue-driven worker that queries `status = 'approved' AND publishAt <= now`
- Calls the Meta Graph API to create the post on the Page/IG Business Account
- Updates status to `published` (with `publishedAt`) or `failed` (with `publishError`)
- Uses the encrypted access token from `meta_connections` (decrypt → use → discard)

**Files involved:** New route at `/api/cron/publish-posts` + new lib module `src/lib/publish/`.

### 2.2 No Middleware — Proxy Module Is Dead Code

**Severity: HIGH**

`src/proxy.ts` exports a `proxy` function and a `config` matcher, but there is no `src/middleware.ts` file that imports or invokes it. In Next.js, the middleware must be at `src/middleware.ts` (or root `middleware.ts`). As a result:
- Unauthenticated users can access `/admin/*`, `/dashboard/*`, and `/welcome/*` directly (they'll see server-side errors or empty pages, but the route is not blocked at the edge)
- The `/login` → redirect for logged-in users doesn't work
- The `/` root redirect to `/login` for anonymous users doesn't work

**Fix:** Create `src/middleware.ts` that imports and delegates to `proxy.ts`.

### 2.3 GET /api/posts Has No Rate Limiting

**Severity: HIGH**

`GET /api/posts` is the main data-fetch endpoint for the dashboard. It has authorization but no rate limiting. A malicious or buggy client could hammer this endpoint.

**Fix:** Add `rateLimitRequest(request, "get-posts", 60, 60_000)` or similar.

### 2.4 POST /api/admin/delete-user Has No Rate Limiting

**Severity: HIGH**

The admin delete endpoint has authorization but no rate limit. While admin-only, a compromised admin session could trigger mass deletions.

**Fix:** Add rate limiting (e.g., 5 deletes per 15 minutes).

### 2.5 Meta OAuth Endpoints Missing Rate Limiting

**Severity: HIGH**

`/api/meta/connect/start` and `/api/meta/callback` have no rate limiting. The callback endpoint makes external API calls to Meta (token exchange + page fetch), so abuse could exhaust API quotas or cause cost issues.

**Fix:** Add rate limiting to both endpoints.

### 2.6 Account Deletion Cancel Endpoint Has No Rate Limiting

**Severity: MEDIUM-HIGH**

`GET /api/account/deletion/cancel` is a public endpoint (anyone with the token can hit it). No rate limiting means it's vulnerable to brute-force token guessing (UUID tokens have 122 bits of entropy, so this is theoretical, but defense-in-depth matters).

**Fix:** Add IP-based rate limiting.

---

## 3. High-Priority Issues

### 3.1 No Input Validation Library (No Zod)

**Severity: HIGH**

Request bodies are parsed with bare `request.json()` and cast with `as`. There is no schema validation on any endpoint. Examples:
- `POST /api/generate-posts`: casts body as `GeneratePostsRequest` without validation
- `POST /api/admin/delete-user`: destructures `{ userId }` from `body as { userId: string }` — no check that userId is actually a string

**Recommendation:** Add Zod schemas for all API request bodies and formData in server actions. This catches malformed input at the boundary instead of deep inside business logic.

### 3.2 No API Versioning or Consistent Response Envelope

**Severity: MEDIUM**

API responses vary in shape:
- Success: `NextResponse.json(result)` — raw data
- Error: `{ error: "message" }` — simple object
- No consistent `{ success, data, error }` envelope

Not blocking for v1, but will cause headaches when the frontend grows or external integrations arrive.

### 3.3 Missing `updatedAt` Maintenance in Several Operations

**Severity: MEDIUM**

The `posts` table has `updatedAt` but several update operations don't set it:
- `markPostAlerted` — updates `alertedAt` but not `updatedAt`
- `markPostRegenLimitAlerted` — same issue
- `markPostsAsSeen` — updates `firstSeenAt` but not `updatedAt`

These are internal bookkeeping updates, so arguably acceptable, but it breaks the contract that `updatedAt` reflects the last modification.

### 3.4 Client Profile Is Hardcoded — Not Configurable Per Client

**Severity: MEDIUM**

`buildClientProfile()` in `src/lib/ai/client-profile.ts` returns hardcoded values for `ownerPersona`, `bannedPhrases`, `targetCustomers`, `hours`, `vibe`, etc. These should eventually be configurable per client in the database. Currently, every client gets the same persona and banned phrases, which only makes sense while Cafe de Hoek is the sole client.

### 3.5 No Publish Scheduling Cron Job in vercel.json

**Severity: MEDIUM**

`vercel.json` only defines two cron jobs:
1. `/api/cron/check-alerts` — hourly
2. `/api/cron/process-deletions` — hourly

There is no cron entry for publishing approved posts. Even once the publisher is built, it needs to be registered here.

### 3.6 Photo Upload Stores as `access: "public"`

**Severity: MEDIUM**

`uploadPhotoToBlob()` stores all photos with `{ access: "public" }`. This means anyone with the blob URL can view client photos. For a B2B product handling client business photos, this should be private with signed URLs.

**Fix:** Use `{ access: "private" }` and generate short-lived signed URLs when serving.

---

## 4. Medium-Priority Issues

### 4.1 Database Pool Has No Connection Limits

`src/db/index.ts` creates a `Pool` with no explicit `max` connections. Neon's serverless driver manages pooling on their side, but it's good practice to set `max: 10` or similar to prevent runaway connections during traffic spikes.

### 4.2 No Request Logging / Observability

There is no structured request logging. Errors are logged with `console.error`, which is fine for Vercel runtime logs, but there is no:
- Request ID tracking
- Structured JSON logging
- Performance timing
- Error reporting service (Sentry, etc.)

For v1 with one client, console.error is acceptable. Before scaling to multiple clients, add structured logging.

### 4.3 AI Client Singleton Pattern May Leak Memory

`src/lib/ai/client.ts` uses a module-level `clientInstance` singleton. In serverless (Vercel Functions), this is fine because instances are recycled. But with Fluid Compute's instance reuse, long-lived singletons could theoretically accumulate state. Low risk, but worth noting.

### 4.4 `extractJSON()` Is Fragile

`src/lib/ai/extract-json.ts` finds the first `{` or `[` and tries to parse from there. If Claude includes a JSON-like snippet in its reasoning text before the actual JSON block, this will parse the wrong thing. The function works well enough for the current prompts, but consider:
- Using Claude's `tool_use` / structured output mode instead of raw text parsing
- At minimum, parsing from the *last* valid JSON block, not the first

### 4.5 `regenerateSinglePost` Imports `db` Directly

`src/lib/ai/regenerate-post.ts` imports `db` at the module level instead of accepting it as a parameter. This makes it harder to test (can't inject a test database) and breaks the dependency-injection pattern used everywhere else in the codebase.

### 4.6 No CORS Configuration

There's no explicit CORS configuration. Next.js API routes default to same-origin, which is correct for a server-rendered app. But if any external tool or mobile app needs to call these APIs in the future, CORS headers will need to be added.

### 4.7 Cron Jobs Return Data on Failure

Both cron routes return JSON bodies even on error (status 500). If Vercel Cron expects a 200 for "ran successfully", this is fine. But the error responses contain internal error messages that could leak information if the cron endpoint were accidentally exposed.

### 4.8 `toErrorResponse()` Logs Full Error Objects

`src/lib/authorization.ts:92` — `console.error(error)` logs the full error object for non-HttpError exceptions. This could include stack traces with file paths, which is acceptable for server logs but worth being aware of.

---

## 5. Architecture Assessment

### What's Done Well

1. **Authorization model is solid.** `requireClientAccess()` enforces tenant isolation — every data access is scoped by `clientId`. Admin/client roles are cleanly separated.

2. **Repository pattern.** Data access is abstracted behind repository functions (`src/lib/posts/repository.ts`, `src/lib/meta/repository.ts`), not inline in route handlers. Functions accept `db` as a parameter, enabling test injection.

3. **Transactional integrity.** `replacePostsForOpenDays()` uses a transaction to atomically delete old posts and insert new ones. The `assertChanged()` helper catches optimistic-concurrency violations.

4. **Encrypted token storage.** Meta access tokens are encrypted with AES-256-GCM before database storage. The encryption key is environment-variable-only.

5. **Rate limiting.** Key endpoints have IP-based rate limiting stored in the database (survives serverless instance recycling). The magic-link throttle is particularly well-designed with serializable transaction isolation.

6. **Test coverage.** 21 test files cover critical backend logic: auth throttle, posts repository, account deletion lifecycle, Meta OAuth, alerts, business hours, crypto, and more.

7. **Deletion lifecycle.** Account deletion has a 24-hour cooling-off period, email confirmation with cancel token, cron-driven execution, audit logging, and cascade cleanup including blob deletion.

8. **OAuth state tokens.** HMAC-signed, time-boxed state tokens prevent CSRF in the Meta OAuth flow.

### What's Missing

1. **Publishing engine** — the core value proposition (auto-publishing approved posts) has no implementation
2. **Middleware activation** — proxy.ts exists but isn't wired up
3. **Input validation** — no Zod or similar at API boundaries
4. **Structured logging** — console.error only
5. **Error monitoring** — no Sentry/similar
6. **Health check endpoint** — no `/api/health` for uptime monitoring
7. **Webhook handling** — no Meta webhook receiver for deauth callbacks or page status changes
8. **Token refresh** — Meta long-lived tokens expire after ~60 days; no refresh logic
9. **Multi-client profile** — hardcoded persona/banned-phrases won't scale beyond first client
10. **Private blob storage** — photos are publicly accessible

---

## 6. Production Readiness Checklist

### Must Have (Blocks Launch)

- [ ] **Build publisher engine** — cron job to publish approved posts via Meta Graph API
- [ ] **Wire up middleware** — create `src/middleware.ts` importing from `proxy.ts`
- [ ] **Add rate limiting** to unprotected routes (`/api/posts`, `/api/admin/delete-user`, meta OAuth routes, deletion cancel)
- [ ] **Add input validation** (Zod) to all API request bodies
- [ ] **Switch photos to private blob storage** with signed URLs
- [ ] **Register publish cron** in `vercel.json`

### Should Have (Before First Paying Client)

- [ ] Add structured logging (at minimum, request IDs)
- [ ] Add error monitoring (Sentry free tier)
- [ ] Add health check endpoint (`/api/health`)
- [ ] Make client profiles configurable per client (persona, banned phrases, etc.)
- [ ] Add Meta token refresh/validation logic
- [ ] Implement Meta webhook receiver for deauth notifications
- [ ] Consistent API response envelope `{ success, data, error }`
- [ ] Fix `regenerateSinglePost` to accept `db` parameter (DI consistency)
- [ ] Fix `updatedAt` not being set in some update operations

### Nice to Have (After Launch)

- [ ] API versioning
- [ ] CORS configuration for future external integrations
- [ ] Switch from text-based JSON extraction to Claude structured output / tool_use
- [ ] Connection pool limits on `db/index.ts`
- [ ] Request performance timing / metrics
- [ ] Admin dashboard API usage tracking
- [ ] Webhook signature verification for Vercel Cron (verify cron-triggered requests are authentic beyond bearer token)

---

## 7. Existing Test Coverage Summary

| Module | Test File | Coverage Area |
|--------|-----------|---------------|
| Posts repository | `posts/__tests__/repository.test.ts` | CRUD, approve, reject, regenerate, locked days, stale posts |
| Posts dates | `posts/__tests__/dates.test.ts` | Date arithmetic, week ranges |
| Posts locked days | `posts/__tests__/locked-days.test.ts` | Locked day context building |
| Posts generation | `posts/__tests__/generate-posts.test.ts` | End-to-end generation flow |
| Auth throttle | `auth/__tests__/throttle.test.ts` | Rate limiting, serializable transactions |
| Account delete | `account/__tests__/delete.test.ts` | User deletion with cascade |
| Account export | `account/__tests__/export.test.ts` | Data export JSON building |
| Account deletion request | `account/__tests__/deletion-request.test.ts` | Request lifecycle |
| Account process deletions | `account/__tests__/process-deletions.test.ts` | Cron sweep |
| Deletion email | `account/__tests__/deletion-email.test.ts` | Email template |
| Stale post alerts | `alerts/__tests__/check-stale-posts.test.ts` | Alert detection + sending |
| Regen limit alerts | `alerts/__tests__/check-regen-limits.test.ts` | Alert detection + sending |
| Alert emails | `alerts/__tests__/*.test.ts` | Email templates |
| Business hours | `time/__tests__/business-hours.test.ts` | NL timezone logic |
| Meta crypto | `meta/__tests__/crypto.test.ts` | Encrypt/decrypt round-trip |
| Meta OAuth state | `meta/__tests__/oauth-state.test.ts` | HMAC signing, expiry |
| Meta OAuth | `meta/__tests__/oauth.test.ts` | Token exchange, page fetch |
| Meta repository | `meta/__tests__/repository.test.ts` | Connection upsert/delete |
| Meta connect route | `api/meta/connect/start/__tests__/route.test.ts` | Route handler |
| Meta callback route | `api/meta/callback/__tests__/route.test.ts` | Callback handler |

**Notable gaps:**
- No tests for `/api/generate-posts` route handler (only the underlying lib function)
- No tests for `/api/posts` route handler
- No tests for `/api/photos/upload` or `/api/photos/[id]/analyze` route handlers
- No tests for `/api/admin/delete-user` route handler
- No tests for `/api/account/deletion/cancel` route handler
- No tests for `/api/cron/check-alerts` or `/api/cron/process-deletions` route handlers
- No tests for server actions (`posts/actions.ts`, `admin/clients/actions.ts`, `dashboard/account/actions.ts`)
- No tests for `proxy.ts` (which isn't even active)

---

## 8. Recommended Next Steps (Priority Order)

1. **Build the publisher engine** — this is the product's core value loop. Without it, approved posts sit forever.
2. **Wire up middleware** — takes 5 minutes, closes a real security gap.
3. **Add rate limiting to unprotected endpoints** — incremental, each takes ~10 minutes.
4. **Add Zod validation to API routes** — incremental, improves robustness at system boundaries.
5. **Switch blob storage to private** — straightforward Vercel Blob config change + signed URL generation.
6. **Make client profiles database-driven** — needed before onboarding a second client.
7. **Add Meta token refresh** — tokens expire after ~60 days; without refresh, publishing silently breaks.
8. **Add structured logging + Sentry** — essential for debugging production issues with real clients.

---

*End of Backend Audit*
