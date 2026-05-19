# Publisher Engine (Plan #5b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take an approved post from "approved" status to "published on Facebook / Instagram" via a manual, admin-triggered queue. Failed publishes surface in the same queue with a Retry button. No auto-publishing, no automatic retry, no email notifications — those are Plan #5c.

**Architecture:** A new `publish_attempts` Postgres table records every API attempt (success or fail) with `metaPostId`, `errorCode`, `errorMessage`, and `requestDurationMs`. The Meta HTTP layer is consolidated into `src/lib/meta/client.ts` (extracted from `oauth.ts`) so `publish.ts` and `oauth.ts` share one error-handling boundary. `publishPostToMeta` is the entry point: it loads the post + client + meta-connection in one join, decrypts the page access token at the call site, dispatches to the Facebook or Instagram path (Instagram requires a photo and is a two-step container/publish dance), then updates the post row and inserts an attempt row. Operator-facing UI lives at `/admin/queue`: a single page listing every post where `status IN ('approved','failed') AND publishedAt IS NULL`, sorted failed-first, each row with a "Publish now" or "Retry" button.

**Tech Stack:** TypeScript, Next.js App Router, Drizzle ORM (Postgres), Vitest + PGlite, `node:fetch` (via the injected `Fetcher` type from 5a). No new dependencies.

**Branch context:** This plan is implemented on `feat/publisher-engine`, branched from `feat/publisher-oauth-tokens` (Plan #5a). 5b genuinely depends on the 5a schema (`meta_connections`) and the crypto/repository helpers, so chaining is the right pattern.

**Rebase plan when 5a merges to `main`:**

```bash
git checkout feat/publisher-engine
git fetch origin
git rebase --onto origin/main feat/publisher-oauth-tokens
# resolve any conflicts (unlikely — 5b's commits are additive)
git push --force-with-lease origin feat/publisher-engine
```

Migration numbering will stay correct: 5a is `0003_groovy_wasp.sql`, 5b will be `0004_*`. If 5a picks up review changes, rebase 5b onto the updated 5a tip first, then onto main.

**Scope guard:** This plan does NOT implement automatic retry on transient errors, token-expiry email notifications, the Attention List "failed posts" surface (already exists separately), or any cron-triggered auto-publishing. If you find yourself writing a setTimeout-based retry loop or `/api/cron/publish-due`, STOP — that's Plan #5c (or Option B, which we already rejected).

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `src/db/migrations/0004_*.sql` | Auto-generated migration adding `publish_attempts`. |
| `src/lib/meta/client.ts` | Shared Meta HTTP boundary. Exports `Fetcher`, `MetaApiError`, `readJsonOrThrow`. Replaces the duplicated helpers currently in `oauth.ts`. |
| `src/lib/meta/__tests__/client.test.ts` | Verifies the JSON / error helpers handle 200, non-200, and non-JSON responses. |
| `src/lib/meta/errors.ts` | `classifyMetaError(code, subcode, status) → ErrorClass`. |
| `src/lib/meta/__tests__/errors.test.ts` | Truth-table over the documented Meta error codes. |
| `src/lib/meta/publish.ts` | `publishPostToMeta` orchestrator + internal `publishToFacebook` / `publishToInstagram` dispatch functions. |
| `src/lib/meta/__tests__/publish.test.ts` | Integration-style tests using PGlite + mocked fetcher. |
| `src/lib/posts/queue-repository.ts` | Two queries for the queue page: `findQueuePosts(db)` and small mutator helpers for marking published / failed / resetting status. |
| `src/lib/posts/__tests__/queue-repository.test.ts` | Tenant isolation + sort order + state-machine guards. |
| `src/app/admin/queue/page.tsx` | Server component — renders queue rows. |
| `src/app/admin/queue/actions.ts` | Server actions `publishPostNowAction` and `retryFailedPostAction`. |
| `src/components/admin/publish-button.tsx` | Client component for the inline publish/retry button. |
| `src/test/db.ts` (modify) | Add `seedMetaConnection` helper. |

### Modified files

| Path | Change |
|---|---|
| `src/db/schema.ts` | Add `publishAttempts` table definition + export. |
| `src/lib/meta/oauth.ts` | Replace inline `MetaApiError` / `readJsonOrThrow` definitions with re-imports from `./client`. |

---

## Conventions

- **Re-use the `Db` type alias** from `src/lib/posts/repository.ts` shape (PgDatabase with full schema typing). Don't introduce a new type-alias home; the consolidation refactor is out of scope.
- **All admin server actions re-check the session role** inside the action body. Never trust the client.
- **All publish logic takes an injected `Fetcher`** so tests stay HTTP-free. No real Meta calls in CI, ever.
- **CSS variables get inline fallbacks** — write `var(--admin-border, #e5e5e5)` not `var(--admin-border)`. The operator-console tokens are introduced on a separate, not-yet-merged branch, so the queue page must render correctly without them. Fallback values come from `src/styles/admin-tokens.css` on the `feat/attention-list` branch.
- **Status transitions go through dedicated mutators**. Don't `db.update(posts).set(...)` from a server action directly; route through the queue-repository so the state machine stays in one place.

---

## Task 1: Pre-flight

**Files:** none

- [ ] **Step 1: Confirm branch**

Run: `git branch --show-current`
Expected: `feat/publisher-engine`

If you see something else, stop. Branch is wrong.

- [ ] **Step 2: Confirm 5a tip is the parent commit**

Run: `git log --oneline -1 feat/publisher-oauth-tokens`
Expected: shows `c1b7f9e docs: PR body draft for publisher oauth tokens` (or whatever the latest 5a commit is).

Run: `git merge-base feat/publisher-engine feat/publisher-oauth-tokens`
Expected: the same SHA as the 5a tip.

If those don't match, 5b is not properly chained on 5a — reset and rebranch.

- [ ] **Step 3: Confirm baseline test count**

Run: `npm test`
Expected: 213 passing (the count after 5a shipped). If lower, 5a hasn't landed on this branch.

---

## Task 2: `publish_attempts` schema + migration

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/0004_*.sql` (auto-generated)

- [ ] **Step 1: Add the table to `src/db/schema.ts`**

Append after the `metaConnections` block:

```typescript
// ──────────────────────────────────────────────
// publishAttempts — one row per Meta API publish attempt, success or fail.
// The full audit trail; posts.publishError is just the most-recent message
// denormalized for the queue display. Cascades on post delete.
// ──────────────────────────────────────────────
export const publishAttempts = pgTable(
  "publish_attempts",
  {
    id: text("id")
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    postId: text("postId")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    attemptedAt: timestamp("attemptedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
    attemptedBy: text("attemptedBy").notNull(),
    metaPostId: text("metaPostId"),
    success: boolean("success").notNull(),
    errorClass: text("errorClass", {
      enum: ["transient", "permanent-token", "permanent-content", "unknown"],
    }),
    errorCode: text("errorCode"),
    errorMessage: text("errorMessage"),
    requestDurationMs: integer("requestDurationMs"),
  },
  (t) => [index("publish_attempts_post_idx").on(t.postId)]
)
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `src/db/migrations/0004_<adjective>_<noun>.sql`. Open it and verify it contains `CREATE TABLE "publish_attempts"`, the FK to `posts.id` with `ON DELETE cascade`, and `CREATE INDEX "publish_attempts_post_idx"`.

- [ ] **Step 3: Apply locally**

Run: `npm run db:migrate`
Expected: applies cleanly to the dev Neon instance.

- [ ] **Step 4: Confirm existing tests still pass**

Run: `npm test`
Expected: 213 passing (PGlite picks up the new migration automatically inside `createTestDb`).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations
git commit -m "feat(meta): add publish_attempts table for the publisher engine"
```

---

## Task 3: Extract `client.ts` — shared Meta HTTP boundary

**Why this refactor:** `oauth.ts` and the upcoming `publish.ts` both need the same JSON-decode + error-classification helpers. Today those helpers (`MetaApiError`, `readJsonOrThrow`, the `Fetcher` type) are private inside `oauth.ts`. Extract them into `client.ts` so there's one HTTP boundary and the publisher doesn't have to duplicate them.

**Files:**
- Create: `src/lib/meta/client.ts`
- Create: `src/lib/meta/__tests__/client.test.ts`
- Modify: `src/lib/meta/oauth.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/lib/meta/__tests__/client.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { readJsonOrThrow, MetaApiError } from "../client"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("readJsonOrThrow", () => {
  it("returns parsed JSON on a 2xx response", async () => {
    const res = jsonResponse({ ok: true, value: 42 })
    const body = (await readJsonOrThrow(res)) as { ok: boolean; value: number }
    expect(body).toEqual({ ok: true, value: 42 })
  })

  it("throws MetaApiError with the graph error message on a 4xx response", async () => {
    const res = jsonResponse(
      { error: { message: "Invalid OAuth access token", code: 190, error_subcode: 463 } },
      400
    )
    await expect(readJsonOrThrow(res)).rejects.toMatchObject({
      name: "MetaApiError",
      message: "Invalid OAuth access token",
      code: 190,
      subcode: 463,
      status: 400,
    })
  })

  it("throws MetaApiError on a 200 with non-JSON body", async () => {
    const res = new Response("not json at all", {
      status: 200,
      headers: { "content-type": "text/plain" },
    })
    await expect(readJsonOrThrow(res)).rejects.toThrow(/non-JSON/)
  })

  it("MetaApiError is an instance of Error", () => {
    const err = new MetaApiError("x", 500)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("MetaApiError")
  })
})
```

- [ ] **Step 2: Run — verify they fail**

Run: `npm test -- src/lib/meta/__tests__/client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/meta/client.ts`**

```typescript
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

export class MetaApiError extends Error {
  readonly code: number | undefined
  readonly subcode: number | undefined
  readonly status: number
  constructor(message: string, status: number, code?: number, subcode?: number) {
    super(message)
    this.name = "MetaApiError"
    this.code = code
    this.subcode = subcode
    this.status = status
  }
}

/**
 * Read a Graph API JSON response. Throws MetaApiError on any non-2xx
 * status (with the graph error fields extracted) or on a non-JSON body.
 */
export async function readJsonOrThrow(res: Response): Promise<unknown> {
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new MetaApiError(
      `Graph API returned non-JSON (status ${res.status})`,
      res.status
    )
  }
  if (!res.ok) {
    const err = (body as {
      error?: { message?: string; code?: number; error_subcode?: number }
    })?.error
    throw new MetaApiError(
      err?.message ?? `Graph API error (status ${res.status})`,
      res.status,
      err?.code,
      err?.error_subcode
    )
  }
  return body
}
```

- [ ] **Step 4: Update `src/lib/meta/oauth.ts` to import from `./client`**

Open `src/lib/meta/oauth.ts`. Replace the top of the file:

```typescript
import { getGraphBaseUrl, getOAuthDialogUrl, META_OAUTH_SCOPES } from "./config"

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
```

with:

```typescript
import { getGraphBaseUrl, getOAuthDialogUrl, META_OAUTH_SCOPES } from "./config"
import { MetaApiError, readJsonOrThrow, type Fetcher } from "./client"

export type { Fetcher }
export { MetaApiError }
```

Then **delete** the in-file `MetaApiError` class definition and the `readJsonOrThrow` function (both block comments and the bodies — they now live in `client.ts`). The rest of `oauth.ts` (`buildAuthUrl`, `exchangeCodeForToken`, `extendUserToken`, `fetchUserPages`, `MetaPage`) stays unchanged.

- [ ] **Step 5: Run all Meta tests**

Run: `npm test -- src/lib/meta`
Expected: all Meta tests pass — `crypto` (5), `oauth-state` (6), `oauth` (11), `repository` (7), `client` (4). Total 33.

- [ ] **Step 6: Commit**

```bash
git add src/lib/meta/client.ts src/lib/meta/__tests__/client.test.ts src/lib/meta/oauth.ts
git commit -m "refactor(meta): extract MetaApiError and readJsonOrThrow into client module

Shared HTTP boundary for both oauth.ts and the upcoming publish.ts.
No behavior change — the helpers move from private exports inside
oauth.ts to a dedicated client.ts; oauth.ts re-exports MetaApiError
and Fetcher so existing imports keep working."
```

---

## Task 4: Error classification — `errors.ts`

**Files:**
- Create: `src/lib/meta/errors.ts`
- Create: `src/lib/meta/__tests__/errors.test.ts`

**Reference:** Meta's [Graph API error codes](https://developers.facebook.com/docs/graph-api/guides/error-handling). The mapping is intentionally conservative — when in doubt, classify as `unknown` (the operator decides how to handle it via Retry).

- [ ] **Step 1: Write the failing test file**

Create `src/lib/meta/__tests__/errors.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { classifyMetaError } from "../errors"

describe("classifyMetaError", () => {
  it("classifies 5xx as transient", () => {
    expect(classifyMetaError(undefined, undefined, 500)).toBe("transient")
    expect(classifyMetaError(undefined, undefined, 503)).toBe("transient")
  })

  it("classifies rate-limit codes as transient", () => {
    expect(classifyMetaError(4, undefined, 400)).toBe("transient")
    expect(classifyMetaError(17, undefined, 400)).toBe("transient")
    expect(classifyMetaError(32, undefined, 400)).toBe("transient")
    expect(classifyMetaError(613, undefined, 400)).toBe("transient")
  })

  it("classifies generic 'API unknown' (code 1, 2) as transient", () => {
    expect(classifyMetaError(1, undefined, 500)).toBe("transient")
    expect(classifyMetaError(2, undefined, 500)).toBe("transient")
  })

  it("classifies OAuthException (code 190) as permanent-token", () => {
    expect(classifyMetaError(190, undefined, 400)).toBe("permanent-token")
    expect(classifyMetaError(190, 463, 400)).toBe("permanent-token") // expired token subcode
  })

  it("classifies permission errors (200) as permanent-token", () => {
    expect(classifyMetaError(200, undefined, 403)).toBe("permanent-token")
  })

  it("classifies IG content-policy code (36003) as permanent-content", () => {
    expect(classifyMetaError(36003, undefined, 400)).toBe("permanent-content")
  })

  it("classifies generic 400 with code 100 (invalid parameter) as permanent-content", () => {
    expect(classifyMetaError(100, undefined, 400)).toBe("permanent-content")
  })

  it("returns unknown when nothing matches", () => {
    expect(classifyMetaError(undefined, undefined, 400)).toBe("unknown")
    expect(classifyMetaError(99999, undefined, 400)).toBe("unknown")
  })
})
```

- [ ] **Step 2: Run — verify they fail**

Run: `npm test -- src/lib/meta/__tests__/errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/meta/errors.ts`**

```typescript
export type ErrorClass =
  | "transient"
  | "permanent-token"
  | "permanent-content"
  | "unknown"

const TRANSIENT_CODES = new Set<number>([
  1, // API Unknown — retry
  2, // API Service — retry
  4, // App rate limit
  17, // User rate limit
  32, // Page rate limit
  613, // Rate limited / call-budget exhausted
])

const TOKEN_CODES = new Set<number>([
  190, // OAuthException — token expired or revoked
  200, // Permissions error (often re-grant is required)
  102, // Session has been invalidated
])

const CONTENT_CODES = new Set<number>([
  100, // Invalid parameter — usually the post content
  36003, // IG content policy rejection
  324, // Missing or invalid image file
  9004, // IG creative not found / unsupported
])

export function classifyMetaError(
  code: number | undefined,
  _subcode: number | undefined,
  status: number
): ErrorClass {
  if (status >= 500) return "transient"
  if (code !== undefined) {
    if (TRANSIENT_CODES.has(code)) return "transient"
    if (TOKEN_CODES.has(code)) return "permanent-token"
    if (CONTENT_CODES.has(code)) return "permanent-content"
  }
  return "unknown"
}
```

- [ ] **Step 4: Run tests — all should pass**

Run: `npm test -- src/lib/meta/__tests__/errors.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/errors.ts src/lib/meta/__tests__/errors.test.ts
git commit -m "feat(meta): error classification for publish-attempt outcomes

Maps Meta Graph API error codes to four classes: transient,
permanent-token, permanent-content, or unknown. Conservative — when
in doubt, returns unknown and lets the operator decide via Retry.
Acting on the classes (auto-retry, token-expiry email) is plan #5c."
```

---

## Task 5: Test helper — `seedMetaConnection`

**Files:**
- Modify: `src/test/db.ts`

- [ ] **Step 1: Append the helper to `src/test/db.ts`**

After `seedTestPhoto`, add:

```typescript
/**
 * Insert a Meta connection row for testing. Encrypts a placeholder
 * token so the row is realistic; tests that need the real plaintext
 * should override `accessTokenPlaintext`.
 */
export async function seedMetaConnection(
  db: TestDb,
  clientId: string,
  overrides: Partial<{
    pageId: string
    pageName: string
    instagramBusinessId: string | null
    accessTokenPlaintext: string
    grantedScopes: string
  }> = {}
) {
  // Set a deterministic encryption key for the helper so callers don't
  // have to. Real tests typically set the same key in beforeEach.
  if (!process.env.META_TOKEN_ENCRYPTION_KEY) {
    process.env.META_TOKEN_ENCRYPTION_KEY =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  }
  // Lazy-load encryption so the test bundler doesn't pull node:crypto
  // earlier than needed.
  const { encryptToken } = await import("@/lib/meta/crypto")
  const accessTokenPlaintext =
    overrides.accessTokenPlaintext ?? "PAGE_TOKEN_PLAINTEXT"
  await db.insert(schema.metaConnections).values({
    clientId,
    pageId: overrides.pageId ?? "PAGE_1",
    pageName: overrides.pageName ?? "Test Page",
    instagramBusinessId: overrides.instagramBusinessId ?? "IG_1",
    encryptedAccessToken: encryptToken(accessTokenPlaintext),
    grantedScopes:
      overrides.grantedScopes ?? "pages_manage_posts,instagram_content_publish",
  })
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/test/db.ts
git commit -m "test(meta): add seedMetaConnection helper for publisher tests"
```

---

## Task 6: `publish.ts` — Facebook path (TDD)

**Files:**
- Create: `src/lib/meta/publish.ts`
- Create: `src/lib/meta/__tests__/publish.test.ts`

**API design notes:**

- `publishToFacebook` is an internal function (not exported from publish.ts to consumers) that takes a decrypted token, the page id, the post content, and an optional photo URL. It returns the `metaPostId` on success or throws `MetaApiError`.
- Facebook with photo → `POST /{PAGE_ID}/photos?access_token=...` with `message` + `url`. Returns `{ id, post_id }`. Use `post_id` (the feed post id), not `id` (the photo id).
- Facebook without photo → `POST /{PAGE_ID}/feed?access_token=...` with `message`. Returns `{ id }`.

- [ ] **Step 1: Write the failing test file**

Create `src/lib/meta/__tests__/publish.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest"
import { publishToFacebook } from "../publish"

beforeEach(() => {
  process.env.META_GRAPH_VERSION = "v21.0"
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("publishToFacebook — with photo", () => {
  it("calls /PAGE_ID/photos with message + url and returns post_id", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST")
      expect(url).toBe("https://graph.facebook.com/v21.0/PAGE_1/photos")
      const body = init?.body as URLSearchParams
      expect(body.get("message")).toBe("Hello world")
      expect(body.get("url")).toBe("https://example.com/photo.jpg")
      expect(body.get("access_token")).toBe("PAGE_TOKEN")
      return jsonResponse({ id: "PHOTO_ID", post_id: "FEED_POST_ID" })
    })

    const id = await publishToFacebook(
      { pageId: "PAGE_1", accessToken: "PAGE_TOKEN" },
      { content: "Hello world", photoUrl: "https://example.com/photo.jpg" },
      fetcher
    )
    expect(id).toBe("FEED_POST_ID")
  })

  it("propagates graph errors as MetaApiError", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { message: "Invalid token", code: 190 } }, 400)
    )
    await expect(
      publishToFacebook(
        { pageId: "PAGE_1", accessToken: "BAD" },
        { content: "x", photoUrl: "https://example.com/photo.jpg" },
        fetcher
      )
    ).rejects.toThrow(/Invalid token/)
  })
})

describe("publishToFacebook — without photo", () => {
  it("calls /PAGE_ID/feed with message only and returns id", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://graph.facebook.com/v21.0/PAGE_1/feed")
      const body = init?.body as URLSearchParams
      expect(body.get("message")).toBe("Text-only post")
      expect(body.get("url")).toBeNull()
      return jsonResponse({ id: "FEED_ID" })
    })
    const id = await publishToFacebook(
      { pageId: "PAGE_1", accessToken: "PAGE_TOKEN" },
      { content: "Text-only post", photoUrl: null },
      fetcher
    )
    expect(id).toBe("FEED_ID")
  })
})
```

- [ ] **Step 2: Run — verify they fail**

Run: `npm test -- src/lib/meta/__tests__/publish.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/meta/publish.ts` with the Facebook path only**

```typescript
import { getGraphBaseUrl } from "./config"
import { readJsonOrThrow, type Fetcher } from "./client"

export interface PageCredentials {
  pageId: string
  accessToken: string
}

export interface PostPayload {
  content: string
  photoUrl: string | null
}

/**
 * Publish to a Facebook Page. With a photo: POST /PAGE_ID/photos (returns
 * post_id alongside the photo id). Without: POST /PAGE_ID/feed (returns id).
 * Throws MetaApiError on graph errors.
 */
export async function publishToFacebook(
  creds: PageCredentials,
  payload: PostPayload,
  fetcher: Fetcher = globalThis.fetch
): Promise<string> {
  const baseUrl = getGraphBaseUrl()
  const body = new URLSearchParams({
    message: payload.content,
    access_token: creds.accessToken,
  })
  let endpoint: string
  if (payload.photoUrl) {
    body.set("url", payload.photoUrl)
    endpoint = `${baseUrl}/${creds.pageId}/photos`
  } else {
    endpoint = `${baseUrl}/${creds.pageId}/feed`
  }
  const res = await fetcher(endpoint, { method: "POST", body })
  const json = (await readJsonOrThrow(res)) as { id?: string; post_id?: string }
  const metaPostId = json.post_id ?? json.id
  if (!metaPostId) {
    throw new Error("Facebook response is missing both post_id and id")
  }
  return metaPostId
}
```

- [ ] **Step 4: Run tests — Facebook tests should pass**

Run: `npm test -- src/lib/meta/__tests__/publish.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/publish.ts src/lib/meta/__tests__/publish.test.ts
git commit -m "feat(meta): publishToFacebook — photos and feed endpoints"
```

---

## Task 7: `publish.ts` — Instagram path (TDD)

**API design notes:**

- IG publishing is a two-step container/publish sequence.
- Step 1: `POST /{IG_USER_ID}/media?access_token=...` with `image_url` + `caption` → returns `{ id: "<container_id>" }`.
- Step 2: `POST /{IG_USER_ID}/media_publish?access_token=...` with `creation_id=<container_id>` → returns `{ id: "<final_media_id>" }`.
- IG requires a photo — there is no text-only path. If `photoUrl` is null, throw a `MetaApiError` with a "no-photo" message before contacting Meta.

**Files:**
- Modify: `src/lib/meta/publish.ts`
- Modify: `src/lib/meta/__tests__/publish.test.ts`

- [ ] **Step 1: Append Instagram tests to `publish.test.ts`**

```typescript
import { publishToInstagram } from "../publish"

describe("publishToInstagram", () => {
  it("creates a media container then publishes it and returns the final id", async () => {
    let step = 0
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      step++
      const body = init?.body as URLSearchParams
      if (step === 1) {
        expect(url).toBe("https://graph.facebook.com/v21.0/IG_1/media")
        expect(body.get("image_url")).toBe("https://example.com/p.jpg")
        expect(body.get("caption")).toBe("Hello IG")
        expect(body.get("access_token")).toBe("PAGE_TOKEN")
        return jsonResponse({ id: "CONTAINER_123" })
      }
      if (step === 2) {
        expect(url).toBe("https://graph.facebook.com/v21.0/IG_1/media_publish")
        expect(body.get("creation_id")).toBe("CONTAINER_123")
        expect(body.get("access_token")).toBe("PAGE_TOKEN")
        return jsonResponse({ id: "IG_MEDIA_FINAL" })
      }
      throw new Error("unexpected extra fetch")
    })
    const id = await publishToInstagram(
      { igUserId: "IG_1", accessToken: "PAGE_TOKEN" },
      { content: "Hello IG", photoUrl: "https://example.com/p.jpg" },
      fetcher
    )
    expect(id).toBe("IG_MEDIA_FINAL")
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("throws a no-photo error without calling Meta when photoUrl is null", async () => {
    const fetcher = vi.fn()
    await expect(
      publishToInstagram(
        { igUserId: "IG_1", accessToken: "PAGE_TOKEN" },
        { content: "no image", photoUrl: null },
        fetcher
      )
    ).rejects.toThrow(/photo/i)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("propagates a container-step failure without calling step 2", async () => {
    let step = 0
    const fetcher = vi.fn(async () => {
      step++
      return jsonResponse({ error: { message: "image fetch failed", code: 324 } }, 400)
    })
    await expect(
      publishToInstagram(
        { igUserId: "IG_1", accessToken: "PAGE_TOKEN" },
        { content: "x", photoUrl: "https://example.com/p.jpg" },
        fetcher
      )
    ).rejects.toThrow(/image fetch failed/)
    expect(step).toBe(1) // only the container call happened
  })
})
```

- [ ] **Step 2: Run — verify Instagram tests fail**

Run: `npm test -- src/lib/meta/__tests__/publish.test.ts -t "publishToInstagram"`
Expected: FAIL — `publishToInstagram` not exported.

- [ ] **Step 3: Append `publishToInstagram` to `src/lib/meta/publish.ts`**

```typescript
import { MetaApiError } from "./client"

export interface InstagramCredentials {
  igUserId: string
  accessToken: string
}

/**
 * Publish to Instagram. Two-step: create a media container, then publish it.
 * Throws MetaApiError if photoUrl is null (IG has no text-only path) or
 * if either Meta call fails.
 */
export async function publishToInstagram(
  creds: InstagramCredentials,
  payload: PostPayload,
  fetcher: Fetcher = globalThis.fetch
): Promise<string> {
  if (!payload.photoUrl) {
    throw new MetaApiError(
      "Instagram posts require a photo; this post has none",
      400
    )
  }
  const baseUrl = getGraphBaseUrl()

  // Step 1: create container
  const containerBody = new URLSearchParams({
    image_url: payload.photoUrl,
    caption: payload.content,
    access_token: creds.accessToken,
  })
  const containerRes = await fetcher(`${baseUrl}/${creds.igUserId}/media`, {
    method: "POST",
    body: containerBody,
  })
  const containerJson = (await readJsonOrThrow(containerRes)) as { id?: string }
  const containerId = containerJson.id
  if (!containerId) {
    throw new MetaApiError("Instagram container response missing id", 200)
  }

  // Step 2: publish container
  const publishBody = new URLSearchParams({
    creation_id: containerId,
    access_token: creds.accessToken,
  })
  const publishRes = await fetcher(`${baseUrl}/${creds.igUserId}/media_publish`, {
    method: "POST",
    body: publishBody,
  })
  const publishJson = (await readJsonOrThrow(publishRes)) as { id?: string }
  if (!publishJson.id) {
    throw new MetaApiError("Instagram publish response missing id", 200)
  }
  return publishJson.id
}
```

- [ ] **Step 4: Run all publish tests**

Run: `npm test -- src/lib/meta/__tests__/publish.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/publish.ts src/lib/meta/__tests__/publish.test.ts
git commit -m "feat(meta): publishToInstagram — two-step container/publish flow

IG publishing requires a photo URL and runs in two API calls: create
media container, then publish it. Container-step failures short-circuit
before the publish call. Text-only IG posts are rejected up-front."
```

---

## Task 8: `publish.ts` — `publishPostToMeta` orchestrator (TDD)

**API design notes:**

- `publishPostToMeta(db, postId, attemptedBy, fetcher?)` is the **only** function the rest of the app should call.
- It loads the post + client + meta_connection + photo (if any) in one join.
- Status guard: post must be `status='approved'`. If not, returns a result indicating the guard failed without writing anything.
- Dispatches to `publishToFacebook` or `publishToInstagram` based on `posts.platform`.
- On any path that contacts Meta: write a `publish_attempts` row (success or fail) and update the `posts` row (`published` or `failed`).
- The post status update uses an additional `eq(posts.status, 'approved')` filter so a double-publish (two concurrent operators clicking) only mutates the row once.

**Files:**
- Modify: `src/lib/meta/publish.ts`
- Modify: `src/lib/meta/__tests__/publish.test.ts`

- [ ] **Step 1: Append orchestrator tests**

Add at the bottom of `src/lib/meta/__tests__/publish.test.ts`:

```typescript
import { createTestDb, seedTestClient, seedTestPhoto, seedMetaConnection, type TestDb } from "@/test/db"
import { posts, publishAttempts } from "@/db/schema"
import { eq } from "drizzle-orm"
import { publishPostToMeta } from "../publish"

const CLIENT_ID = "test-client-001"
const ENC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

let db: TestDb

async function seedApprovedPost(opts: {
  platform: "instagram" | "facebook"
  withPhoto: boolean
  content?: string
}) {
  const photoId = opts.withPhoto ? "photo-1" : null
  if (photoId) await seedTestPhoto(db, CLIENT_ID, photoId)
  await db.insert(posts).values({
    clientId: CLIENT_ID,
    platform: opts.platform,
    scheduledDate: "2026-05-12",
    status: "approved",
    content: opts.content ?? "hello",
    reasoning: "test",
    photoId,
    publishAt: new Date(),
    approvedAt: new Date(),
  })
  const row = await db.select().from(posts).where(eq(posts.clientId, CLIENT_ID))
  return row[0]
}

describe("publishPostToMeta — orchestrator", () => {
  beforeEach(async () => {
    process.env.META_TOKEN_ENCRYPTION_KEY = ENC_KEY
    process.env.META_GRAPH_VERSION = "v21.0"
    db = await createTestDb()
    await seedTestClient(db, CLIENT_ID)
    await seedMetaConnection(db, CLIENT_ID, {
      accessTokenPlaintext: "PAGE_TOKEN_PLAINTEXT",
    })
  })

  it("returns guard-failed when the post is not in 'approved' status", async () => {
    await db.insert(posts).values({
      clientId: CLIENT_ID,
      platform: "instagram",
      scheduledDate: "2026-05-12",
      status: "draft",
      content: "x",
      reasoning: "x",
    })
    const draft = (await db.select().from(posts))[0]

    const result = await publishPostToMeta(db, draft.id, "admin-1", vi.fn())
    expect(result.success).toBe(false)
    expect(result.guardFailure).toBe("not-approved")

    // No publish_attempts row should be written for guard failures.
    const attempts = await db.select().from(publishAttempts)
    expect(attempts).toHaveLength(0)
  })

  it("returns guard-failed when the post has no meta connection", async () => {
    // delete the seeded connection
    await db.delete((await import("@/db/schema")).metaConnections)
    const post = await seedApprovedPost({ platform: "facebook", withPhoto: false })

    const result = await publishPostToMeta(db, post.id, "admin-1", vi.fn())
    expect(result.success).toBe(false)
    expect(result.guardFailure).toBe("no-connection")
  })

  it("publishes a Facebook text post and updates state on success", async () => {
    const post = await seedApprovedPost({ platform: "facebook", withPhoto: false })
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ id: "FB_FEED_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    )

    const result = await publishPostToMeta(db, post.id, "admin-1", fetcher)
    expect(result.success).toBe(true)
    expect(result.metaPostId).toBe("FB_FEED_1")

    const updated = (await db.select().from(posts).where(eq(posts.id, post.id)))[0]
    expect(updated.status).toBe("published")
    expect(updated.publishedAt).toBeInstanceOf(Date)
    expect(updated.publishError).toBeNull()

    const attempts = await db.select().from(publishAttempts).where(eq(publishAttempts.postId, post.id))
    expect(attempts).toHaveLength(1)
    expect(attempts[0].success).toBe(true)
    expect(attempts[0].metaPostId).toBe("FB_FEED_1")
    expect(attempts[0].attemptedBy).toBe("admin-1")
    expect(typeof attempts[0].requestDurationMs).toBe("number")
  })

  it("publishes a Facebook photo post using /photos and stores post_id", async () => {
    const post = await seedApprovedPost({ platform: "facebook", withPhoto: true })
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain("/photos")
      return new Response(
        JSON.stringify({ id: "PHOTO_ID", post_id: "FB_FEED_2" }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    })
    const result = await publishPostToMeta(db, post.id, "admin-1", fetcher)
    expect(result.metaPostId).toBe("FB_FEED_2")
  })

  it("publishes an Instagram post via the two-step flow", async () => {
    const post = await seedApprovedPost({ platform: "instagram", withPhoto: true })
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "CONTAINER" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "IG_FINAL" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    const result = await publishPostToMeta(db, post.id, "admin-1", fetcher)
    expect(result.success).toBe(true)
    expect(result.metaPostId).toBe("IG_FINAL")
  })

  it("records a failure and flips status to 'failed' when Meta returns an error", async () => {
    const post = await seedApprovedPost({ platform: "facebook", withPhoto: false })
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: "Token expired", code: 190 } }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    )

    const result = await publishPostToMeta(db, post.id, "admin-1", fetcher)
    expect(result.success).toBe(false)
    expect(result.errorClass).toBe("permanent-token")
    expect(result.errorMessage).toMatch(/Token expired/)

    const updated = (await db.select().from(posts).where(eq(posts.id, post.id)))[0]
    expect(updated.status).toBe("failed")
    expect(updated.publishError).toMatch(/Token expired/)
    expect(updated.publishedAt).toBeNull()

    const attempts = await db.select().from(publishAttempts).where(eq(publishAttempts.postId, post.id))
    expect(attempts).toHaveLength(1)
    expect(attempts[0].success).toBe(false)
    expect(attempts[0].errorClass).toBe("permanent-token")
    expect(attempts[0].errorMessage).toMatch(/Token expired/)
  })

  it("does not re-publish a post that is already 'published' (idempotent guard)", async () => {
    const post = await seedApprovedPost({ platform: "facebook", withPhoto: false })
    // Pre-flip to published to simulate a concurrent winner.
    await db
      .update(posts)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(posts.id, post.id))

    const fetcher = vi.fn()
    const result = await publishPostToMeta(db, post.id, "admin-1", fetcher)
    expect(result.success).toBe(false)
    expect(result.guardFailure).toBe("not-approved")
    expect(fetcher).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — verify the orchestrator tests fail**

Run: `npm test -- src/lib/meta/__tests__/publish.test.ts -t "orchestrator"`
Expected: FAIL — `publishPostToMeta` not exported.

- [ ] **Step 3: Implement the orchestrator in `src/lib/meta/publish.ts`**

Append:

```typescript
import { eq, and } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"
import { decryptToken } from "./crypto"
import { classifyMetaError, type ErrorClass } from "./errors"

type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export type GuardFailure = "not-approved" | "no-connection" | "ig-no-photo"

export interface PublishResult {
  success: boolean
  metaPostId?: string
  guardFailure?: GuardFailure
  errorClass?: ErrorClass
  errorMessage?: string
}

interface JoinedRow {
  postId: string
  status: schema.posts.$inferSelect["status"]
  platform: schema.posts.$inferSelect["platform"]
  content: string
  photoUrl: string | null
  pageId: string | null
  igUserId: string | null
  encryptedAccessToken: string | null
}

async function loadJoinedRow(db: Db, postId: string): Promise<JoinedRow | null> {
  const rows = await db
    .select({
      postId: schema.posts.id,
      status: schema.posts.status,
      platform: schema.posts.platform,
      content: schema.posts.content,
      photoUrl: schema.photos.blobUrl,
      pageId: schema.metaConnections.pageId,
      igUserId: schema.metaConnections.instagramBusinessId,
      encryptedAccessToken: schema.metaConnections.encryptedAccessToken,
    })
    .from(schema.posts)
    .leftJoin(schema.photos, eq(schema.posts.photoId, schema.photos.id))
    .leftJoin(
      schema.metaConnections,
      eq(schema.metaConnections.clientId, schema.posts.clientId)
    )
    .where(eq(schema.posts.id, postId))
    .limit(1)
  return (rows[0] as JoinedRow | undefined) ?? null
}

/**
 * Publish a single approved post to its platform. The only entry point
 * for the publisher. Returns a structured result; never throws on
 * Meta-side failures (those are recorded in publish_attempts).
 *
 * Throws only on real bugs (DB unavailable, decryption failure, etc.).
 */
export async function publishPostToMeta(
  db: Db,
  postId: string,
  attemptedBy: string,
  fetcher: Fetcher = globalThis.fetch
): Promise<PublishResult> {
  const row = await loadJoinedRow(db, postId)
  if (!row) {
    return { success: false, guardFailure: "not-approved" }
  }
  if (row.status !== "approved") {
    return { success: false, guardFailure: "not-approved" }
  }
  if (!row.encryptedAccessToken || !row.pageId) {
    return { success: false, guardFailure: "no-connection" }
  }
  if (row.platform === "instagram" && !row.photoUrl) {
    return { success: false, guardFailure: "ig-no-photo" }
  }

  const accessToken = decryptToken(row.encryptedAccessToken)
  const start = Date.now()

  try {
    let metaPostId: string
    if (row.platform === "facebook") {
      metaPostId = await publishToFacebook(
        { pageId: row.pageId, accessToken },
        { content: row.content, photoUrl: row.photoUrl },
        fetcher
      )
    } else {
      if (!row.igUserId) {
        return { success: false, guardFailure: "no-connection" }
      }
      metaPostId = await publishToInstagram(
        { igUserId: row.igUserId, accessToken },
        { content: row.content, photoUrl: row.photoUrl },
        fetcher
      )
    }
    const duration = Date.now() - start

    // Update post + insert attempt in one transaction. Status guard on
    // the update prevents a concurrent operator from double-flipping.
    await db.transaction(async (tx) => {
      await tx
        .update(schema.posts)
        .set({
          status: "published",
          publishedAt: new Date(),
          publishError: null,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.posts.id, postId), eq(schema.posts.status, "approved")))
      await tx.insert(schema.publishAttempts).values({
        postId,
        attemptedBy,
        metaPostId,
        success: true,
        requestDurationMs: duration,
      })
    })

    return { success: true, metaPostId }
  } catch (error: unknown) {
    const duration = Date.now() - start
    const isMeta = error instanceof MetaApiError
    const message =
      error instanceof Error ? error.message : "Onbekende publish-fout"
    const errorClass: ErrorClass = isMeta
      ? classifyMetaError(error.code, error.subcode, error.status)
      : "unknown"
    const errorCode = isMeta && error.code !== undefined ? String(error.code) : null

    await db.transaction(async (tx) => {
      await tx
        .update(schema.posts)
        .set({
          status: "failed",
          publishError: message,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.posts.id, postId), eq(schema.posts.status, "approved")))
      await tx.insert(schema.publishAttempts).values({
        postId,
        attemptedBy,
        success: false,
        errorClass,
        errorCode,
        errorMessage: message,
        requestDurationMs: duration,
      })
    })

    return { success: false, errorClass, errorMessage: message }
  }
}
```

- [ ] **Step 4: Run the full publish test file**

Run: `npm test -- src/lib/meta/__tests__/publish.test.ts`
Expected: PASS (13 tests — 3 Facebook + 3 Instagram + 7 orchestrator).

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/publish.ts src/lib/meta/__tests__/publish.test.ts
git commit -m "feat(meta): publishPostToMeta orchestrator with attempt logging

Single entry point for the publisher. Loads post + client + connection
+ photo in one join, decrypts the page token at the call site, dispatches
to the Facebook or Instagram path, and writes both the publish_attempts
audit row and the status update inside one transaction. Status guard on
the UPDATE prevents concurrent double-publishes.

Guard failures (post not approved, no connection, IG with no photo) are
returned as structured PublishResult.guardFailure without writing an
attempt row. Meta errors flip the post to 'failed' and record the
classified error (transient / permanent-token / permanent-content /
unknown) in publish_attempts."
```

---

## Task 9: Queue repository — `findQueuePosts` + reset helper

**Files:**
- Create: `src/lib/posts/queue-repository.ts`
- Create: `src/lib/posts/__tests__/queue-repository.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/posts/__tests__/queue-repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import {
  createTestDb,
  seedTestClient,
  seedTestPhoto,
  type TestDb,
} from "@/test/db"
import { posts } from "@/db/schema"
import { eq } from "drizzle-orm"
import { findQueuePosts, resetFailedPostToApproved } from "../queue-repository"

const CLIENT_ID = "test-client-001"

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
  await seedTestClient(db, CLIENT_ID)
})

async function insertPost(opts: {
  status: "draft" | "approved" | "rejected" | "published" | "failed"
  scheduledDate?: string
  platform?: "instagram" | "facebook"
  publishedAt?: Date | null
  publishError?: string | null
  photoId?: string | null
}) {
  await db.insert(posts).values({
    clientId: CLIENT_ID,
    platform: opts.platform ?? "instagram",
    scheduledDate: opts.scheduledDate ?? "2026-05-12",
    status: opts.status,
    content: "x",
    reasoning: "x",
    publishAt: new Date(opts.scheduledDate ?? "2026-05-12"),
    publishedAt: opts.publishedAt ?? null,
    publishError: opts.publishError ?? null,
    photoId: opts.photoId ?? null,
  })
  const all = await db.select().from(posts).where(eq(posts.clientId, CLIENT_ID))
  return all[all.length - 1]
}

describe("findQueuePosts", () => {
  it("returns approved + failed posts without publishedAt", async () => {
    await insertPost({ status: "approved" })
    await insertPost({ status: "failed", publishError: "old error", scheduledDate: "2026-05-13" })
    await insertPost({ status: "draft", scheduledDate: "2026-05-14" })
    await insertPost({
      status: "published",
      publishedAt: new Date(),
      scheduledDate: "2026-05-15",
    })

    const queue = await findQueuePosts(db)
    expect(queue).toHaveLength(2)
    expect(queue.map((p) => p.status).sort()).toEqual(["approved", "failed"])
  })

  it("sorts failed first, then by publishAt ascending", async () => {
    await insertPost({ status: "approved", scheduledDate: "2026-05-12" })
    await insertPost({ status: "failed", scheduledDate: "2026-05-15", publishError: "x" })
    await insertPost({ status: "approved", scheduledDate: "2026-05-10" })
    await insertPost({ status: "failed", scheduledDate: "2026-05-13", publishError: "y" })

    const queue = await findQueuePosts(db)
    expect(queue.map((p) => p.status)).toEqual([
      "failed",
      "failed",
      "approved",
      "approved",
    ])
    // Within the failed group: 2026-05-13 then 2026-05-15
    expect(queue[0].scheduledDate).toBe("2026-05-13")
    expect(queue[1].scheduledDate).toBe("2026-05-15")
    // Within the approved group: 2026-05-10 then 2026-05-12
    expect(queue[2].scheduledDate).toBe("2026-05-10")
    expect(queue[3].scheduledDate).toBe("2026-05-12")
  })

  it("joins client businessName and photo blobUrl", async () => {
    await seedTestPhoto(db, CLIENT_ID, "photo-1")
    await insertPost({ status: "approved", photoId: "photo-1" })

    const queue = await findQueuePosts(db)
    expect(queue[0].businessName).toBe("Test Café")
    expect(queue[0].photoUrl).toContain("photo-1")
  })

  it("returns hasMetaConnection=false when the client has no connection", async () => {
    await insertPost({ status: "approved" })
    const queue = await findQueuePosts(db)
    expect(queue[0].hasMetaConnection).toBe(false)
  })
})

describe("resetFailedPostToApproved", () => {
  it("flips a failed post back to approved and clears the error", async () => {
    const failed = await insertPost({ status: "failed", publishError: "old" })
    await resetFailedPostToApproved(db, failed.id)
    const updated = (await db.select().from(posts).where(eq(posts.id, failed.id)))[0]
    expect(updated.status).toBe("approved")
    expect(updated.publishError).toBeNull()
  })

  it("does NOT change a published post", async () => {
    const published = await insertPost({
      status: "published",
      publishedAt: new Date(),
    })
    await resetFailedPostToApproved(db, published.id)
    const updated = (await db.select().from(posts).where(eq(posts.id, published.id)))[0]
    expect(updated.status).toBe("published")
  })

  it("does NOT change a draft post", async () => {
    const draft = await insertPost({ status: "draft" })
    await resetFailedPostToApproved(db, draft.id)
    const updated = (await db.select().from(posts).where(eq(posts.id, draft.id)))[0]
    expect(updated.status).toBe("draft")
  })
})
```

- [ ] **Step 2: Run — verify they fail**

Run: `npm test -- src/lib/posts/__tests__/queue-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/posts/queue-repository.ts`**

```typescript
import { and, asc, desc, eq, inArray, isNull, isNotNull } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"

type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export interface QueuePost {
  id: string
  clientId: string
  businessName: string
  platform: "instagram" | "facebook"
  status: "approved" | "failed"
  scheduledDate: string
  publishAt: Date | null
  content: string
  photoUrl: string | null
  publishError: string | null
  hasMetaConnection: boolean
}

/**
 * Posts that the operator can act on from /admin/queue:
 *   - status IN ('approved', 'failed')
 *   - publishedAt IS NULL
 * Failed rows sort first so they're at the top. Within each status
 * group, sort by publishAt ascending (earliest scheduled first).
 */
export async function findQueuePosts(db: Db): Promise<QueuePost[]> {
  const rows = await db
    .select({
      id: schema.posts.id,
      clientId: schema.posts.clientId,
      businessName: schema.clients.businessName,
      platform: schema.posts.platform,
      status: schema.posts.status,
      scheduledDate: schema.posts.scheduledDate,
      publishAt: schema.posts.publishAt,
      content: schema.posts.content,
      photoUrl: schema.photos.blobUrl,
      publishError: schema.posts.publishError,
      metaConnectionId: schema.metaConnections.id,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.posts.clientId, schema.clients.id))
    .leftJoin(schema.photos, eq(schema.posts.photoId, schema.photos.id))
    .leftJoin(
      schema.metaConnections,
      eq(schema.metaConnections.clientId, schema.posts.clientId)
    )
    .where(
      and(
        inArray(schema.posts.status, ["approved", "failed"]),
        isNull(schema.posts.publishedAt)
      )
    )
    // 'failed' > 'approved' alphabetically, so desc puts failed first
    .orderBy(desc(schema.posts.status), asc(schema.posts.publishAt))

  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    businessName: r.businessName,
    platform: r.platform as "instagram" | "facebook",
    status: r.status as "approved" | "failed",
    scheduledDate: r.scheduledDate,
    publishAt: r.publishAt,
    content: r.content,
    photoUrl: r.photoUrl,
    publishError: r.publishError,
    hasMetaConnection: r.metaConnectionId !== null,
  }))
}

/**
 * Flip a failed post back to approved and clear the error. No-op when
 * the post is in any other state. The publisher's own status guard
 * on the published/failed update prevents races.
 */
export async function resetFailedPostToApproved(
  db: Db,
  postId: string
): Promise<void> {
  await db
    .update(schema.posts)
    .set({
      status: "approved",
      publishError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.posts.id, postId), eq(schema.posts.status, "failed")))
}

// Helper unused outside repository; kept for readability of the WHERE clause above.
export const _ALSO_NOT_PUBLISHED = isNotNull
```

Note: the `_ALSO_NOT_PUBLISHED` export at the bottom is a stub to keep the `isNotNull` import alive in case a future query needs it; remove if eslint flags it.

- [ ] **Step 4: Run tests; verify they pass**

Run: `npm test -- src/lib/posts/__tests__/queue-repository.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint check**

Run: `npm run lint`
Expected: no errors in the new file. If `_ALSO_NOT_PUBLISHED`/`isNotNull` triggers an unused-export warning, delete both the import and the export.

- [ ] **Step 6: Commit**

```bash
git add src/lib/posts/queue-repository.ts src/lib/posts/__tests__/queue-repository.test.ts
git commit -m "feat(posts): queue repository — findQueuePosts and reset helper

findQueuePosts powers /admin/queue: posts where status IN
('approved','failed') AND publishedAt IS NULL, sorted failed-first
then by scheduled time ascending. Joins clients + photos + meta
connections so the queue UI can show business name, photo thumb,
and whether the client is even connectable in one round-trip.

resetFailedPostToApproved drives the Retry button — it only acts
on failed rows, leaving published/draft/etc. untouched."
```

---

## Task 10: Server actions — `publishPostNowAction`, `retryFailedPostAction`

**Files:**
- Create: `src/app/admin/queue/actions.ts`

- [ ] **Step 1: Create `src/app/admin/queue/actions.ts`**

```typescript
"use server"

import { auth } from "@/lib/auth"
import { db } from "@/db"
import { revalidatePath } from "next/cache"
import { publishPostToMeta, type PublishResult } from "@/lib/meta/publish"
import { resetFailedPostToApproved } from "@/lib/posts/queue-repository"

interface ActionResult {
  success: boolean
  metaPostId?: string
  errorMessage?: string
  errorReason?: string
}

function toActionResult(r: PublishResult): ActionResult {
  if (r.success) {
    return { success: true, metaPostId: r.metaPostId }
  }
  if (r.guardFailure) {
    return { success: false, errorReason: r.guardFailure }
  }
  return {
    success: false,
    errorReason: r.errorClass ?? "unknown",
    errorMessage: r.errorMessage,
  }
}

/**
 * Operator clicks "Publish now" on an approved post.
 * Admin-only. Refreshes /admin/queue after the attempt.
 */
export async function publishPostNowAction(
  postId: string
): Promise<ActionResult> {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return { success: false, errorReason: "forbidden" }
  }
  const result = await publishPostToMeta(db, postId, session.user.id)
  revalidatePath("/admin/queue")
  return toActionResult(result)
}

/**
 * Operator clicks "Retry" on a failed post. Flips status back to
 * approved (clearing the previous error), then immediately re-tries
 * the publish. Two-step so the publisher's own status guard still
 * applies normally.
 */
export async function retryFailedPostAction(
  postId: string
): Promise<ActionResult> {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return { success: false, errorReason: "forbidden" }
  }
  await resetFailedPostToApproved(db, postId)
  const result = await publishPostToMeta(db, postId, session.user.id)
  revalidatePath("/admin/queue")
  return toActionResult(result)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/queue/actions.ts
git commit -m "feat(admin): server actions for publish-now and retry-failed"
```

---

## Task 11: Publish button — client component

**Files:**
- Create: `src/components/admin/publish-button.tsx`

**Aesthetic:** Same operator-console palette as 5a, but with explicit fallbacks because `--admin-*` tokens are only defined on `feat/attention-list` (not yet merged to main).

- [ ] **Step 1: Create `src/components/admin/publish-button.tsx`**

```typescript
"use client"

import { useState, useTransition } from "react"
import {
  publishPostNowAction,
  retryFailedPostAction,
} from "@/app/admin/queue/actions"

interface PublishButtonProps {
  postId: string
  mode: "publish" | "retry"
  disabled?: boolean
  disabledReason?: string | null
}

const reasonText: Record<string, string> = {
  forbidden: "Niet bevoegd.",
  "not-approved": "Post is niet (meer) goedgekeurd.",
  "no-connection": "Deze klant heeft geen Meta-koppeling.",
  "ig-no-photo": "Instagram vereist een foto. Deze post heeft er geen.",
  "permanent-token": "Meta-token verlopen. Klant opnieuw verbinden.",
  "permanent-content": "Meta weigerde de inhoud van deze post.",
  transient: "Tijdelijke fout bij Meta. Probeer het opnieuw.",
  unknown: "Onbekende fout. Zie publish_attempts voor details.",
}

export default function PublishButton({
  postId,
  mode,
  disabled = false,
  disabledReason = null,
}: PublishButtonProps) {
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{
    ok: boolean
    text: string
  } | null>(null)

  function go() {
    setFeedback(null)
    startTransition(async () => {
      const result =
        mode === "retry"
          ? await retryFailedPostAction(postId)
          : await publishPostNowAction(postId)
      if (result.success) {
        setFeedback({ ok: true, text: `Gepubliceerd (${result.metaPostId}).` })
      } else {
        const reason = result.errorReason ?? "unknown"
        const msg = reasonText[reason] ?? "Er ging iets mis."
        setFeedback({
          ok: false,
          text: result.errorMessage ? `${msg} (${result.errorMessage})` : msg,
        })
      }
    })
  }

  const baseStyle: React.CSSProperties = {
    padding: "6px 12px",
    fontSize: "13px",
    borderRadius: "4px",
    border: "1px solid var(--admin-border-strong, #d4d4d4)",
    backgroundColor: "var(--admin-surface, #ffffff)",
    color: "var(--admin-text, #1a1a1a)",
    cursor: disabled || pending ? "not-allowed" : "pointer",
    opacity: disabled || pending ? 0.6 : 1,
  }
  const retryStyle: React.CSSProperties = {
    ...baseStyle,
    color: "var(--admin-sev-warn, #b45309)",
    borderColor: "var(--admin-sev-warn, #b45309)",
  }
  const isRetry = mode === "retry"

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <button
        type="button"
        onClick={go}
        disabled={disabled || pending}
        style={isRetry ? retryStyle : baseStyle}
        title={disabledReason ?? undefined}
      >
        {pending
          ? isRetry
            ? "Opnieuw publiceren..."
            : "Publiceren..."
          : isRetry
          ? "Opnieuw publiceren"
          : "Publiceer nu"}
      </button>
      {feedback && (
        <span
          style={{
            fontSize: "12px",
            color: feedback.ok
              ? "var(--admin-text-muted, #525252)"
              : "var(--admin-sev-critical, #b91c1c)",
          }}
        >
          {feedback.text}
        </span>
      )}
      {disabled && disabledReason && (
        <span
          style={{
            fontSize: "12px",
            color: "var(--admin-text-muted, #525252)",
          }}
        >
          {disabledReason}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/publish-button.tsx
git commit -m "feat(admin): publish-button client component with retry mode

Single button component that drives both publishPostNowAction and
retryFailedPostAction. Inline feedback per attempt outcome (success
shows the meta post id; failure shows the friendly Dutch reason for
the error class). Disabled state with tooltip-style reason for posts
that can't be published at all (e.g. client not connected)."
```

---

## Task 12: `/admin/queue` page

**Files:**
- Create: `src/app/admin/queue/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { db } from "@/db"
import { findQueuePosts } from "@/lib/posts/queue-repository"
import PublishButton from "@/components/admin/publish-button"

export const dynamic = "force-dynamic"

function platformBadge(platform: "instagram" | "facebook") {
  const label = platform === "instagram" ? "IG" : "FB"
  return (
    <span
      style={{
        fontSize: "11px",
        padding: "1px 6px",
        borderRadius: "3px",
        border: "1px solid var(--admin-border, #e5e5e5)",
        color: "var(--admin-text-muted, #525252)",
      }}
    >
      {label}
    </span>
  )
}

function statusPill(status: "approved" | "failed") {
  const isFailed = status === "failed"
  return (
    <span
      style={{
        fontSize: "11px",
        padding: "1px 8px",
        borderRadius: "999px",
        color: isFailed
          ? "var(--admin-sev-critical, #b91c1c)"
          : "var(--admin-text-muted, #525252)",
        border: `1px solid ${
          isFailed
            ? "var(--admin-sev-critical, #b91c1c)"
            : "var(--admin-border, #e5e5e5)"
        }`,
      }}
    >
      {status === "failed" ? "Failed" : "Approved"}
    </span>
  )
}

export default async function QueuePage() {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    redirect("/login")
  }

  const queue = await findQueuePosts(db)

  return (
    <main style={{ padding: "32px", maxWidth: "960px" }}>
      <div style={{ marginBottom: "24px" }}>
        <Link
          href="/admin"
          style={{ color: "#666", fontSize: "13px", textDecoration: "none" }}
        >
          ← Back to admin
        </Link>
      </div>
      <h1
        style={{
          fontSize: "20px",
          fontWeight: 600,
          margin: 0,
          marginBottom: "8px",
          color: "var(--admin-text, #1a1a1a)",
        }}
      >
        Publish queue
      </h1>
      <p
        style={{
          fontSize: "13px",
          color: "var(--admin-text-muted, #525252)",
          margin: 0,
          marginBottom: "24px",
        }}
      >
        Approved posts ready to publish, plus posts that failed and need a
        retry. {queue.length} item{queue.length === 1 ? "" : "s"}.
      </p>

      {queue.length === 0 ? (
        <p
          style={{
            padding: "32px",
            border: "1px dashed var(--admin-border, #e5e5e5)",
            borderRadius: "6px",
            textAlign: "center",
            color: "var(--admin-text-subtle, #737373)",
          }}
        >
          Niets te publiceren. Goed bezig.
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {queue.map((post) => {
            const igNoPhoto =
              post.platform === "instagram" && post.photoUrl === null
            const noConnection = !post.hasMetaConnection
            const disabled = igNoPhoto || noConnection
            const disabledReason = noConnection
              ? "Klant heeft geen Meta-koppeling."
              : igNoPhoto
              ? "Instagram vereist een foto."
              : null

            return (
              <li
                key={post.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: "16px",
                  alignItems: "start",
                  padding: "16px 20px",
                  border: "1px solid var(--admin-border, #e5e5e5)",
                  borderRadius: "6px",
                  backgroundColor: "var(--admin-surface, #ffffff)",
                }}
              >
                <div
                  style={{
                    width: "56px",
                    height: "56px",
                    backgroundColor: "var(--admin-bg, #fafafa)",
                    border: "1px solid var(--admin-border, #e5e5e5)",
                    borderRadius: "4px",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--admin-text-subtle, #737373)",
                    fontSize: "11px",
                  }}
                >
                  {post.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.photoUrl}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    "geen foto"
                  )}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                      marginBottom: "4px",
                    }}
                  >
                    <Link
                      href={`/admin/clients/${post.clientId}`}
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "var(--admin-text, #1a1a1a)",
                        textDecoration: "none",
                      }}
                    >
                      {post.businessName}
                    </Link>
                    {platformBadge(post.platform)}
                    {statusPill(post.status)}
                    <span
                      style={{
                        fontSize: "12px",
                        color: "var(--admin-text-subtle, #737373)",
                      }}
                    >
                      {post.scheduledDate}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: "13px",
                      color: "var(--admin-text-muted, #525252)",
                      margin: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {post.content}
                  </p>
                  {post.publishError && (
                    <p
                      style={{
                        fontSize: "12px",
                        color: "var(--admin-sev-critical, #b91c1c)",
                        margin: "6px 0 0 0",
                      }}
                    >
                      {post.publishError}
                    </p>
                  )}
                </div>

                <PublishButton
                  postId={post.id}
                  mode={post.status === "failed" ? "retry" : "publish"}
                  disabled={disabled}
                  disabledReason={disabledReason}
                />
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors in the new file. The `<img>` tag is intentional (Next/Image needs allowed-domains config we don't want to add for an internal admin tool); the eslint-disable comment is in place.

- [ ] **Step 3: Full test suite — confirm nothing regressed**

Run: `npm test`
Expected: 213 (5a baseline) + ~28 new tests pass.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: build succeeds and `/admin/queue` appears in the route list as ƒ Dynamic.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/queue/page.tsx
git commit -m "feat(admin): /admin/queue — operator-driven publish queue

Server component listing every approved-or-failed post that still
needs publishing. Failed posts sort to the top with the prior
publish_error in red; approved posts follow in scheduled order.
Disabled state with explanation for posts that can't be published
(no Meta connection, IG without a photo). Photo thumbnails inline
when present.

Operator-console aesthetic with explicit fallback values so the
page renders correctly whether or not the attention-list branch
(which introduces --admin-* CSS tokens) has landed."
```

---

## Task 13: Final verification + PR body draft + push

**Files:**
- Create: `.pr-body-publisher-engine.md`

- [ ] **Step 1: One more full pass**

Run: `npm test`
Expected: ~241 tests pass (213 baseline + ~28 new).

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: success. Confirm `/admin/queue` shows up under "Route (app)".

- [ ] **Step 2: Write the PR body**

Create `.pr-body-publisher-engine.md`:

```markdown
## Summary

Second slice of the publisher path (Plan #5b). Builds on the OAuth + token
storage foundation from #5a and adds the actual publish-to-Meta flow plus
the operator-driven queue.

**Depends on:** `feat/publisher-oauth-tokens` (Plan #5a). Merge that PR first;
this branch will rebase cleanly onto the updated main.

- New `publish_attempts` Postgres table — one row per publish API call,
  recording success / metaPostId / errorClass / errorCode / errorMessage /
  duration. Cascades on post delete. Powers the audit trail and future
  retry policy (Plan #5c).
- `src/lib/meta/client.ts` — extracted shared HTTP boundary (`MetaApiError`,
  `readJsonOrThrow`, the `Fetcher` type). `oauth.ts` now imports from here
  instead of holding private copies.
- `src/lib/meta/errors.ts` — `classifyMetaError(code, subcode, status)`
  maps to one of `transient | permanent-token | permanent-content | unknown`.
- `src/lib/meta/publish.ts`:
  - `publishToFacebook` — handles both `/PAGE_ID/photos` (with photo, returns
    `post_id`) and `/PAGE_ID/feed` (text-only, returns `id`).
  - `publishToInstagram` — two-step container/publish flow, rejects
    text-only IG posts up-front.
  - `publishPostToMeta(db, postId, attemptedBy, fetcher?)` — the single
    entry point. Loads post + client + connection in one join, decrypts
    the token, dispatches, writes both the `publish_attempts` audit row
    and the post status update inside one transaction. Concurrent-safe
    via a status-guard on the UPDATE.
- `src/lib/posts/queue-repository.ts` — `findQueuePosts` (returns approved
  + failed posts with joined business name and photo URL) and
  `resetFailedPostToApproved` (drives the Retry button).
- Two server actions: `publishPostNowAction`, `retryFailedPostAction`.
- New `/admin/queue` page — server component listing every actionable
  post with inline publish/retry buttons and disabled-with-reason for
  unconnectable clients or IG-without-photo cases.
- `<PublishButton>` client component, used in both publish and retry modes.

Total: 241 tests passing (213 from 5a baseline + ~28 new), production
build clean.

## What is NOT in this PR (still Plan #5c)

- No automatic retry on `transient` errors. The classification is recorded
  but the operator drives every attempt.
- No token-expiry email notifications. A `permanent-token` failure marks
  the post failed and surfaces in the queue with the Meta error message;
  the operator manually reconnects via `/admin/clients/[id]`.
- No Attention List wiring — failed posts are visible in the queue, not
  cross-linked from the Attention List (that's a separate surface).
- No cron-based auto-publishing — Option B from the spec stays off.

## Rebase plan after #5a merges to main

```bash
git checkout feat/publisher-engine
git fetch origin
git rebase --onto origin/main feat/publisher-oauth-tokens
git push --force-with-lease origin feat/publisher-engine
```

If #5a picks up review changes before merge, rebase onto the updated
5a tip first, then onto main.

## Required env vars

Same set as #5a — no new env vars in this branch. The publisher reads
`META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION`, and the
`META_TOKEN_ENCRYPTION_KEY` already set during #5a.

## Test plan

- [ ] Merge #5a first.
- [ ] Rebase this branch using the commands above.
- [ ] Run `npm test` — expect ~241 passing.
- [ ] Run `npm run build` — expect success and `/admin/queue` in the route table.
- [ ] Run `npm run dev`. Sign in as admin.
- [ ] Connect Café Test Arnhem via the panel from #5a.
- [ ] Approve a draft post (in any existing dashboard surface or directly
      via Drizzle Studio for the smoke test).
- [ ] Visit `/admin/queue`. The post should appear as an Approved row.
- [ ] Click "Publiceer nu". Wait. Within ~3s, the row should disappear
      (the post is now `published`, no longer in the queue).
- [ ] Check Drizzle Studio: `posts` row has `status='published'`, the
      meta post id is in `publish_attempts.metaPostId`, and the actual
      post appears on Facebook / Instagram.
- [ ] Force a failure: temporarily edit `meta_connections.encryptedAccessToken`
      to a garbage value via Drizzle Studio. Approve a post. Click publish.
      The row should turn red with a "permanent-token" error. Click "Opnieuw
      publiceren" → still fails. Restore the encrypted token from a fresh
      reconnect to recover.

## Out-of-scope reminders

- IG posts with no photo are silently filtered to a disabled state in
  the queue, not auto-dropped. The operator can see them and knows why.
- The Meta App is still in Development Mode — only added testers can
  receive published content.
- `posts.publishError` is the most-recent error only; the full history
  lives in `publish_attempts` (no UI for it yet).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 3: Commit the PR body**

```bash
git add .pr-body-publisher-engine.md
git commit -m "docs: PR body draft for publisher engine"
```

- [ ] **Step 4: Push**

```bash
git push -u origin feat/publisher-engine
```

Expected: branch published. GitHub returns a PR creation URL.

---

## Self-Review Checklist

After all tasks land, verify each spec section drove a real task:

- [ ] **Spec §3a — `publish_attempts` schema:** `attemptedAt`, `attemptedBy`, `metaPostId`, `success`, `errorCode`, `errorMessage`, `requestDurationMs`. ✅ Task 2 — plus an `errorClass` column the spec didn't mention but is load-bearing for #5c.
- [ ] **Spec §3d — `metaFetch` HTTP wrapper:** Refactored as `client.ts` instead of a separate `metaFetch` function — same role. 429 retry is **not** included (deferred to #5c). ✅ Task 3.
- [ ] **Spec §3d — `publishPostToMeta` signature + flow:** signature matches `(db, postId, attemptedBy, deps?)` modulo dropping the `deps` shape (we inline `fetcher` since `now` and `encryptionKey` aren't actually needed at call sites). ✅ Task 8.
- [ ] **Spec §3d steps 1–7:** load row → choose path → IG two-step / FB single → status update → attempt row. ✅ Task 8.
- [ ] **Spec §3e — `/admin/queue` page + `<PublishButton>`:** ✅ Tasks 10–12.
- [ ] **Spec §3g — error classification:** mapping ships in `errors.ts`; **acting** on the classes (auto-retry, token-expiry email) is still #5c.
- [ ] **Hard rule — no real Meta in tests:** every test uses an injected fetcher. ✅
- [ ] **Hard rule — admin-only:** both server actions re-check session role; queue page redirects on non-admin. ✅
- [ ] **Hard rule — `client_id` discipline:** the queue query and the publisher both go through joins, no raw `db.update` from server actions. ✅
- [ ] **Hard rule — no unencrypted tokens at rest:** publish.ts decrypts inside the orchestrator function and never persists the plaintext. ✅

If any item shows a gap, add a task and implement before opening the PR.
