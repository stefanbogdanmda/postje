# Publisher Core (Manual Publish-From-Queue) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take approved posts from "scheduled" to "published on Instagram or Facebook" via a Stefan-triggered admin queue. Each approved post gets a "Publish now" button at `/admin/queue`; clicking it pushes the post to Meta's Graph API and records the outcome.

**Architecture:** A new `publish_attempts` audit table records every API call. A new `src/lib/meta/publish.ts` module owns the publish logic, taking an injected `fetcher` so tests run without contacting Meta. A new `/admin/queue` page server-renders the list of approved-but-unpublished posts; a `publishPostNowAction` server action wraps the publish logic and is called by an admin-only client button. The decision to publish stays with Stefan for v1; the cron-driven Option B path is explicitly out of scope.

**Tech Stack:** Next.js App Router (server components + server actions), Neon Postgres + Drizzle, AES-256-GCM for token decryption (existing `src/lib/meta/crypto.ts`), Vitest + PGlite for tests, Meta Graph API v21.0.

**Source spec:** `docs/superpowers/specs/2026-05-12-publisher-design.md` (sections 1, 3a (publisher subset), 3d, 3e, 3g, 4, 5). OAuth + token storage (#5a, spec §3b/§3c) is already shipped — this plan picks up where that left off.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/lib/meta/errors.ts` | Map Meta API error codes to `transient`/`token-expired`/`content-rejected` classes |
| `src/lib/meta/graph-client.ts` | Thin HTTP wrapper around Graph API. One exported `metaFetch(url, init, fetcher?)` function. |
| `src/lib/meta/publish.ts` | `publishPostToMeta(db, postId, deps, attemptedBy)` — orchestrates read → decrypt → API call → DB update → audit row |
| `src/lib/meta/__tests__/errors.test.ts` | Error-classifier tests (mapping table) |
| `src/lib/meta/__tests__/graph-client.test.ts` | HTTP wrapper tests (mocked fetcher) |
| `src/lib/meta/__tests__/publish.test.ts` | Publish-logic tests (mocked fetcher + real PGlite) |
| `src/lib/admin/queue.ts` | `getQueueItems(db)` — read approved-but-unpublished posts joined with client + connection metadata |
| `src/lib/admin/__tests__/queue.test.ts` | Queue-query tests |
| `src/app/admin/queue/page.tsx` | Server component: lists queue items, renders one row per post |
| `src/app/admin/queue/actions.ts` | `publishPostNowAction(postId)` server action (admin-only wrapper around `publishPostToMeta`) |
| `src/components/admin/publish-button.tsx` | Client component: button + loading/success/error states |
| `src/db/migrations/0004_<auto>.sql` | Auto-generated migration for `publish_attempts` |

### Modified files

| Path | Change |
|---|---|
| `src/db/schema.ts` | Append the `publishAttempts` table definition |
| `src/lib/meta/repository.ts` | Add `getDecryptedTokenByClient`, `insertPublishAttempt`, `getRecentAttemptsForPost` |
| `src/app/admin/page.tsx` *(or its header/nav)* | Add a link to `/admin/queue` so Stefan can find it |

### Why this shape

- **`graph-client.ts` separate from `publish.ts`** so tests can mock at the HTTP boundary without re-implementing Meta's two-step IG flow.
- **`errors.ts` separate** so the classifier is testable as a pure function — no DB, no fetcher.
- **`publish.ts` takes a `deps` object** (with `fetcher` and `now`) so each test seeds Postgres but never reaches the real network.
- **Queue page is a thin server component** that only renders. All logic lives in `src/lib/admin/queue.ts` (testable) and the server action.

---

## Conventions to follow

These are observed patterns in the repo — match them.

- **`Db` type alias** is duplicated across files (`src/lib/posts/repository.ts:18`, `src/lib/meta/repository.ts:6`, `src/lib/alerts/*`). Continue the pattern — do not refactor in this plan. Use:

  ```typescript
  import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
  import type { ExtractTablesWithRelations } from "drizzle-orm"
  import * as schema from "@/db/schema"

  type Db = PgDatabase<
    PgQueryResultHKT,
    typeof schema,
    ExtractTablesWithRelations<typeof schema>
  >
  ```

- **No Zod** in this repo (deliberate — see `package.json`). Validate manually.
- **Server actions** return `{ ok?: true, ...data }` or `{ error: string }`. Match `src/app/admin/clients/[id]/meta-actions.ts`.
- **Admin-only routes** check `session.user.role === "admin"` directly OR call `requireAdmin()` from `src/lib/authorization.ts`. Use the helper.
- **Tests** use Vitest + PGlite via `createTestDb()` and `seedTestClient()` from `src/test/db.ts`. Match `src/lib/meta/__tests__/repository.test.ts`.
- **Commit messages** follow conventional commits: `feat(meta): ...`, `test(meta): ...`. Check `git log --oneline` for tone.

---

## Task 1: Schema — add `publish_attempts` table

**Files:**
- Modify: `src/db/schema.ts` (append at end of file, after `metaConnections`)
- Create: `src/db/migrations/0004_<auto>.sql` (Drizzle generates)

**Spec reference:** §3a `publish_attempts` table definition.

- [ ] **Step 1: Add the table definition**

Append to `src/db/schema.ts`:

```typescript
// ──────────────────────────────────────────────
// publishAttempts — audit trail for every Meta API publish attempt.
// One row per attempt. The `success` flag plus error fields tell us
// what happened; the most-recent error is also denormalized onto
// posts.publishError for the Attention List.
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
      enum: ["transient", "token-expired", "content-rejected"],
    }),
    errorCode: text("errorCode"),
    errorMessage: text("errorMessage"),
    requestDurationMs: integer("requestDurationMs"),
  },
  (t) => [index("publish_attempts_post_idx").on(t.postId)]
)
```

Note: `errorClass` is nullable — only populated on failure. `metaPostId` is nullable — only populated on success.

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file appears at `src/db/migrations/0004_<random-name>.sql` containing `CREATE TABLE "publish_attempts" (...)` and an index. Drizzle also updates `meta/_journal.json` and snapshots.

- [ ] **Step 3: Run the migration against local Neon dev**

Run: `npm run db:migrate`
Expected: output mentions applying `0004_*.sql`; no errors.

- [ ] **Step 4: Spot-check the schema TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations/0004_*.sql src/db/migrations/meta/
git commit -m "feat(db): add publish_attempts table for meta publish audit trail"
```

---

## Task 2: Error classifier — `src/lib/meta/errors.ts`

**Files:**
- Create: `src/lib/meta/errors.ts`
- Create: `src/lib/meta/__tests__/errors.test.ts`

**Spec reference:** §3g (retry semantics table) — three error classes determine retry policy. This task isolates the classification logic so the publisher itself stays simple.

Background — Meta returns errors as:
```json
{ "error": { "code": 190, "error_subcode": 463, "message": "...", "type": "OAuthException" } }
```

Classes:
- **transient** — 5xx, 429, network/timeout — operator can retry
- **token-expired** — code 190 (OAuthException) or related auth errors — needs reconnect, do not auto-retry
- **content-rejected** — Meta rejected the post body (banned phrases, broken image URL, etc.) — needs edit/regen

- [ ] **Step 1: Write the failing test**

Create `src/lib/meta/__tests__/errors.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { classifyMetaError, type MetaApiError } from "../errors"

describe("classifyMetaError", () => {
  it("classifies 5xx HTTP status as transient", () => {
    const result = classifyMetaError({ httpStatus: 503, body: null })
    expect(result.class).toBe("transient")
  })

  it("classifies 429 as transient", () => {
    const result = classifyMetaError({ httpStatus: 429, body: null })
    expect(result.class).toBe("transient")
  })

  it("classifies network timeout (no httpStatus) as transient", () => {
    const result = classifyMetaError({ httpStatus: null, body: null })
    expect(result.class).toBe("transient")
  })

  it("classifies OAuthException code 190 as token-expired", () => {
    const result = classifyMetaError({
      httpStatus: 400,
      body: { error: { code: 190, type: "OAuthException", message: "Token expired" } },
    })
    expect(result.class).toBe("token-expired")
    expect(result.code).toBe("190")
    expect(result.message).toBe("Token expired")
  })

  it("classifies 4xx with non-auth error code as content-rejected", () => {
    const result = classifyMetaError({
      httpStatus: 400,
      body: { error: { code: 100, message: "Invalid parameter" } },
    })
    expect(result.class).toBe("content-rejected")
    expect(result.code).toBe("100")
  })

  it("classifies missing error body on 4xx as content-rejected", () => {
    const result = classifyMetaError({ httpStatus: 400, body: null })
    expect(result.class).toBe("content-rejected")
    expect(result.message).toBe("HTTP 400")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/meta/__tests__/errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/meta/errors.ts`:

```typescript
/** What we know about a failed Graph API call. */
export interface MetaApiError {
  /** HTTP status code from the response, or null for network/timeout errors. */
  httpStatus: number | null
  /** Parsed JSON body, or null if the response had no JSON. */
  body: unknown
}

export type MetaErrorClass = "transient" | "token-expired" | "content-rejected"

export interface ClassifiedError {
  class: MetaErrorClass
  /** Meta's `error.code` as a string, or null if not present. */
  code: string | null
  /** Best human-readable message we can derive. */
  message: string
}

interface MetaErrorBody {
  error?: {
    code?: number
    error_subcode?: number
    type?: string
    message?: string
  }
}

function parseErrorBody(body: unknown): MetaErrorBody["error"] | undefined {
  if (typeof body !== "object" || body === null) return undefined
  const maybe = (body as MetaErrorBody).error
  if (typeof maybe !== "object" || maybe === null) return undefined
  return maybe
}

/**
 * Classify a failed Meta API response into one of three retry classes.
 * Pure function — no I/O.
 */
export function classifyMetaError(err: MetaApiError): ClassifiedError {
  const { httpStatus, body } = err
  const metaError = parseErrorBody(body)
  const code = metaError?.code != null ? String(metaError.code) : null
  const message =
    metaError?.message ?? (httpStatus != null ? `HTTP ${httpStatus}` : "Network error")

  // No HTTP status = network failure / timeout = transient
  if (httpStatus === null) {
    return { class: "transient", code, message }
  }

  // 5xx and 429 are transient
  if (httpStatus >= 500 || httpStatus === 429) {
    return { class: "transient", code, message }
  }

  // OAuthException (code 190) = token problem
  if (metaError?.code === 190 || metaError?.type === "OAuthException") {
    return { class: "token-expired", code, message }
  }

  // Everything else 4xx = content rejection
  return { class: "content-rejected", code, message }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/meta/__tests__/errors.test.ts`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/errors.ts src/lib/meta/__tests__/errors.test.ts
git commit -m "feat(meta): classifier for transient/token-expired/content-rejected errors"
```

---

## Task 3: Graph API HTTP client — `src/lib/meta/graph-client.ts`

**Files:**
- Create: `src/lib/meta/graph-client.ts`
- Create: `src/lib/meta/__tests__/graph-client.test.ts`

**Spec reference:** §3d "Three modules" — `client.ts`. A thin wrapper that adds User-Agent + timeout and parses the response shape into either `{ok: true, body}` or `{ok: false, httpStatus, body}`.

Background — we inject `fetcher` so tests don't actually hit Meta. In production, the default is global `fetch`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/meta/__tests__/graph-client.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { metaFetch } from "../graph-client"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("metaFetch", () => {
  it("returns ok=true with parsed body on 2xx", async () => {
    const fetcher = async () => jsonResponse(200, { id: "POST_123" })
    const result = await metaFetch("https://graph.facebook.com/v21.0/me", {}, fetcher)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.body).toEqual({ id: "POST_123" })
    }
  })

  it("returns ok=false with httpStatus and body on 4xx", async () => {
    const fetcher = async () =>
      jsonResponse(400, { error: { code: 100, message: "bad" } })
    const result = await metaFetch("https://example", {}, fetcher)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.httpStatus).toBe(400)
      expect(result.body).toEqual({ error: { code: 100, message: "bad" } })
    }
  })

  it("returns ok=false with httpStatus=null on network failure", async () => {
    const fetcher = async () => {
      throw new TypeError("fetch failed")
    }
    const result = await metaFetch("https://example", {}, fetcher)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.httpStatus).toBeNull()
    }
  })

  it("records durationMs in the result", async () => {
    const fetcher = async () => jsonResponse(200, {})
    const result = await metaFetch("https://example", {}, fetcher)
    expect(typeof result.durationMs).toBe("number")
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("passes through method and body to the fetcher", async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const fetcher = async (url: string, init?: RequestInit) => {
      captured = { url, init: init ?? {} }
      return jsonResponse(200, {})
    }
    await metaFetch(
      "https://example",
      { method: "POST", body: "x=1" },
      fetcher
    )
    expect(captured?.url).toBe("https://example")
    expect(captured?.init.method).toBe("POST")
    expect(captured?.init.body).toBe("x=1")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/meta/__tests__/graph-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/meta/graph-client.ts`:

```typescript
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

export interface MetaFetchOk {
  ok: true
  httpStatus: number
  body: unknown
  durationMs: number
}

export interface MetaFetchErr {
  ok: false
  httpStatus: number | null
  body: unknown
  durationMs: number
}

export type MetaFetchResult = MetaFetchOk | MetaFetchErr

const USER_AGENT = "social-ai/0.1 (+https://github.com/stefanbogdanmda/social-ai)"
const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Call the Meta Graph API. Always resolves — never throws — so callers
 * can branch cleanly on the result shape. The `fetcher` param is for
 * tests; production code calls `metaFetch(url, init)` and gets global fetch.
 */
export async function metaFetch(
  url: string,
  init: RequestInit = {},
  fetcher: Fetcher = fetch
): Promise<MetaFetchResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  const startedAt = Date.now()

  try {
    const response = await fetcher(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        ...(init.headers ?? {}),
      },
    })
    const durationMs = Date.now() - startedAt
    const body = await parseJsonSafe(response)

    if (response.ok) {
      return { ok: true, httpStatus: response.status, body, durationMs }
    }
    return { ok: false, httpStatus: response.status, body, durationMs }
  } catch (error: unknown) {
    return {
      ok: false,
      httpStatus: null,
      body: null,
      durationMs: Date.now() - startedAt,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/meta/__tests__/graph-client.test.ts`
Expected: PASS — 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/graph-client.ts src/lib/meta/__tests__/graph-client.test.ts
git commit -m "feat(meta): graph api http wrapper with injectable fetcher"
```

---

## Task 4: Repository helpers — decrypted token + publish_attempts writes

**Files:**
- Modify: `src/lib/meta/repository.ts` (add three exports)
- Modify: `src/lib/meta/__tests__/repository.test.ts` (add tests for the new exports)

**Spec reference:** §3d Step 1 ("Read the `posts` row + joined `clients` + joined `meta_accounts`"). The publisher needs:
1. Encrypted token + page metadata for a given client → decrypted at read time.
2. Insert a `publish_attempts` row after each attempt.
3. (For debugging the queue page) Most recent attempt per post.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/meta/__tests__/repository.test.ts`:

```typescript
import {
  getDecryptedConnectionByClient,
  insertPublishAttempt,
  getMostRecentAttemptForPost,
} from "../repository"
import { encryptToken } from "../crypto"
import * as schema from "@/db/schema"

const REAL_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd=="
// 32-byte base64 test key; set in beforeEach via process.env
const ORIGINAL_ENCRYPTION_KEY = process.env.META_TOKEN_ENCRYPTION_KEY

describe("getDecryptedConnectionByClient", () => {
  beforeEach(() => {
    process.env.META_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
  })

  it("returns null when no connection exists", async () => {
    const result = await getDecryptedConnectionByClient(db, CLIENT_ID)
    expect(result).toBeNull()
  })

  it("returns the connection with decrypted token", async () => {
    const encrypted = encryptToken("real-page-token-xyz")
    await upsertConnection(db, makeInput({ encryptedAccessToken: encrypted }))

    const result = await getDecryptedConnectionByClient(db, CLIENT_ID)
    expect(result).not.toBeNull()
    expect(result!.accessToken).toBe("real-page-token-xyz")
    expect(result!.pageId).toBe("PAGE_1")
    expect(result!.instagramBusinessId).toBe("IG_1")
  })

  afterAll(() => {
    process.env.META_TOKEN_ENCRYPTION_KEY = ORIGINAL_ENCRYPTION_KEY
  })
})

describe("insertPublishAttempt", () => {
  it("writes a success attempt row", async () => {
    // Seed a post first
    const postId = "post-1"
    await db.insert(schema.posts).values({
      id: postId,
      clientId: CLIENT_ID,
      platform: "facebook",
      scheduledDate: "2026-05-20",
      status: "approved",
      content: "Hello",
      reasoning: "test",
    })

    await insertPublishAttempt(db, {
      postId,
      attemptedBy: "user-admin",
      success: true,
      metaPostId: "META_POST_99",
      requestDurationMs: 250,
    })

    const rows = await db.select().from(schema.publishAttempts)
    expect(rows).toHaveLength(1)
    expect(rows[0].success).toBe(true)
    expect(rows[0].metaPostId).toBe("META_POST_99")
  })

  it("writes a failure attempt row with error fields", async () => {
    const postId = "post-2"
    await db.insert(schema.posts).values({
      id: postId,
      clientId: CLIENT_ID,
      platform: "instagram",
      scheduledDate: "2026-05-21",
      status: "approved",
      content: "Hi",
      reasoning: "test",
    })

    await insertPublishAttempt(db, {
      postId,
      attemptedBy: "user-admin",
      success: false,
      errorClass: "content-rejected",
      errorCode: "100",
      errorMessage: "Invalid image URL",
      requestDurationMs: 180,
    })

    const rows = await db.select().from(schema.publishAttempts)
    expect(rows).toHaveLength(1)
    expect(rows[0].success).toBe(false)
    expect(rows[0].errorClass).toBe("content-rejected")
    expect(rows[0].errorMessage).toBe("Invalid image URL")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/meta/__tests__/repository.test.ts`
Expected: FAIL — `getDecryptedConnectionByClient`, `insertPublishAttempt` not exported.

- [ ] **Step 3: Add the implementations**

Append to `src/lib/meta/repository.ts`:

```typescript
import { desc } from "drizzle-orm"
import { decryptToken } from "./crypto"

export interface DecryptedConnection {
  id: string
  clientId: string
  pageId: string
  pageName: string
  instagramBusinessId: string | null
  accessToken: string
  grantedScopes: string
}

/**
 * Read the connection for a client and decrypt its token. Returns null
 * if no row exists. Throws if decryption fails (tampered or wrong key).
 */
export async function getDecryptedConnectionByClient(
  db: Db,
  clientId: string
): Promise<DecryptedConnection | null> {
  const connection = await getConnectionByClient(db, clientId)
  if (!connection) return null
  return {
    id: connection.id,
    clientId: connection.clientId,
    pageId: connection.pageId,
    pageName: connection.pageName,
    instagramBusinessId: connection.instagramBusinessId,
    accessToken: decryptToken(connection.encryptedAccessToken),
    grantedScopes: connection.grantedScopes,
  }
}

export interface PublishAttemptInput {
  postId: string
  attemptedBy: string
  success: boolean
  metaPostId?: string | null
  errorClass?: "transient" | "token-expired" | "content-rejected" | null
  errorCode?: string | null
  errorMessage?: string | null
  requestDurationMs?: number | null
}

/**
 * Append a row to `publish_attempts`. Caller is responsible for also
 * updating the denormalized fields on `posts` (status, publishedAt,
 * publishError) — those are atomic UPDATE statements done elsewhere.
 */
export async function insertPublishAttempt(
  db: Db,
  input: PublishAttemptInput
): Promise<void> {
  await db.insert(schema.publishAttempts).values({
    postId: input.postId,
    attemptedBy: input.attemptedBy,
    success: input.success,
    metaPostId: input.metaPostId ?? null,
    errorClass: input.errorClass ?? null,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    requestDurationMs: input.requestDurationMs ?? null,
  })
}

/**
 * Fetch the most recent attempt for a post, for surfacing the latest
 * error message on the queue page.
 */
export async function getMostRecentAttemptForPost(
  db: Db,
  postId: string
): Promise<typeof schema.publishAttempts.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.publishAttempts)
    .where(eq(schema.publishAttempts.postId, postId))
    .orderBy(desc(schema.publishAttempts.attemptedAt))
    .limit(1)
  return rows[0] ?? null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/meta/__tests__/repository.test.ts`
Expected: PASS — all repository tests including the new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/repository.ts src/lib/meta/__tests__/repository.test.ts
git commit -m "feat(meta): decrypted-connection getter and publish_attempts writes"
```

---

## Task 5: Publish logic — Facebook path (text + photo)

**Files:**
- Create: `src/lib/meta/publish.ts`
- Create: `src/lib/meta/__tests__/publish.test.ts`

**Spec reference:** §3d "Steps 1–4" and "Facebook path." Single endpoint:
- Text-only post → `POST /{PAGE_ID}/feed` with `message`
- Photo post → `POST /{PAGE_ID}/photos` with `url` + `message`

Both return `{ id: "PAGE_ID_POST_ID" }` on success.

This task ships ONLY the Facebook path. Instagram lands in Task 6.

- [ ] **Step 1: Write the failing test**

Create `src/lib/meta/__tests__/publish.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { createTestDb, seedTestClient, seedTestPhoto, type TestDb } from "@/test/db"
import { upsertConnection } from "../repository"
import { encryptToken } from "../crypto"
import { publishPostToMeta } from "../publish"
import * as schema from "@/db/schema"
import type { Fetcher } from "../graph-client"

const CLIENT_ID = "test-client-001"
const ORIGINAL_KEY = process.env.META_TOKEN_ENCRYPTION_KEY

let db: TestDb

beforeEach(async () => {
  process.env.META_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
  db = await createTestDb()
  await seedTestClient(db, CLIENT_ID)
  await upsertConnection(db, {
    clientId: CLIENT_ID,
    pageId: "PAGE_1",
    pageName: "Café Test",
    instagramBusinessId: "IG_1",
    encryptedAccessToken: encryptToken("test-token"),
    grantedScopes: "pages_manage_posts,instagram_content_publish",
  })
})

afterAll(() => {
  process.env.META_TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

async function seedApprovedPost(args: {
  id: string
  platform: "facebook" | "instagram"
  photoId?: string | null
  content?: string
}) {
  await db.insert(schema.posts).values({
    id: args.id,
    clientId: CLIENT_ID,
    platform: args.platform,
    scheduledDate: "2026-05-20",
    status: "approved",
    content: args.content ?? "Hello world",
    photoId: args.photoId ?? null,
    reasoning: "test",
  })
}

describe("publishPostToMeta — Facebook path", () => {
  it("publishes a text-only Facebook post via /feed", async () => {
    await seedApprovedPost({ id: "post-fb-1", platform: "facebook" })

    let capturedUrl = ""
    const fetcher: Fetcher = async (url) => {
      capturedUrl = url
      return jsonResponse(200, { id: "PAGE_1_999" })
    }

    const result = await publishPostToMeta(
      db,
      "post-fb-1",
      { fetcher, now: new Date() },
      "user-admin"
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.metaPostId).toBe("PAGE_1_999")
    }
    expect(capturedUrl).toContain("/PAGE_1/feed")

    const [post] = await db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.id, "post-fb-1"))
    expect(post.status).toBe("published")
    expect(post.publishedAt).not.toBeNull()
    expect(post.publishError).toBeNull()

    const attempts = await db.select().from(schema.publishAttempts)
    expect(attempts).toHaveLength(1)
    expect(attempts[0].success).toBe(true)
  })

  it("publishes a photo Facebook post via /photos with url + message", async () => {
    await seedTestPhoto(db, CLIENT_ID, "photo-1")
    await seedApprovedPost({ id: "post-fb-2", platform: "facebook", photoId: "photo-1" })

    let captured: { url: string; body: string } = { url: "", body: "" }
    const fetcher: Fetcher = async (url, init) => {
      captured = { url, body: String(init?.body ?? "") }
      return jsonResponse(200, { id: "PAGE_1_888" })
    }

    const result = await publishPostToMeta(
      db,
      "post-fb-2",
      { fetcher, now: new Date() },
      "user-admin"
    )

    expect(result.ok).toBe(true)
    expect(captured.url).toContain("/PAGE_1/photos")
    expect(captured.body).toContain("url=https")
    expect(captured.body).toContain("photo-1.jpg")
  })

  it("marks status=failed and writes error on permanent content rejection", async () => {
    await seedApprovedPost({ id: "post-fb-3", platform: "facebook" })

    const fetcher: Fetcher = async () =>
      jsonResponse(400, { error: { code: 100, message: "Invalid parameter" } })

    const result = await publishPostToMeta(
      db,
      "post-fb-3",
      { fetcher, now: new Date() },
      "user-admin"
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorClass).toBe("content-rejected")
      expect(result.errorMessage).toContain("Invalid parameter")
    }

    const [post] = await db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.id, "post-fb-3"))
    expect(post.status).toBe("failed")
    expect(post.publishError).toContain("Invalid parameter")
    expect(post.publishedAt).toBeNull()
  })

  it("marks status=failed but does not lose publish error on token expiry", async () => {
    await seedApprovedPost({ id: "post-fb-4", platform: "facebook" })

    const fetcher: Fetcher = async () =>
      jsonResponse(400, {
        error: { code: 190, type: "OAuthException", message: "Token expired" },
      })

    const result = await publishPostToMeta(
      db,
      "post-fb-4",
      { fetcher, now: new Date() },
      "user-admin"
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorClass).toBe("token-expired")
    }

    const [post] = await db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.id, "post-fb-4"))
    expect(post.status).toBe("failed")
    expect(post.publishError).toContain("Token expired")
  })

  it("returns an error when the client has no Meta connection", async () => {
    // Different client without a connection
    const otherClient = "test-client-002"
    await seedTestClient(db, otherClient)
    await db.insert(schema.posts).values({
      id: "post-orphan",
      clientId: otherClient,
      platform: "facebook",
      scheduledDate: "2026-05-20",
      status: "approved",
      content: "Hi",
      reasoning: "test",
    })

    const fetcher: Fetcher = async () => jsonResponse(200, { id: "x" })
    const result = await publishPostToMeta(
      db,
      "post-orphan",
      { fetcher, now: new Date() },
      "user-admin"
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toMatch(/no.*meta.*connection/i)
    }
    // No HTTP call should have been made — fetcher would have returned 200
    // but the publisher should fail before calling it. Confirm post stays
    // 'approved' rather than 'failed'.
    const [post] = await db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.id, "post-orphan"))
    expect(post.status).toBe("approved")
  })

  it("returns an error when the post is not in 'approved' status", async () => {
    await db.insert(schema.posts).values({
      id: "post-draft",
      clientId: CLIENT_ID,
      platform: "facebook",
      scheduledDate: "2026-05-20",
      status: "draft",
      content: "Hi",
      reasoning: "test",
    })

    const fetcher: Fetcher = async () => jsonResponse(200, { id: "x" })
    const result = await publishPostToMeta(
      db,
      "post-draft",
      { fetcher, now: new Date() },
      "user-admin"
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toMatch(/not approved/i)
    }
  })
})
```

Note: `eq` is imported indirectly via the assertions. Add the import:

```typescript
import { eq } from "drizzle-orm"
```

at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/meta/__tests__/publish.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation (Facebook path only)**

Create `src/lib/meta/publish.ts`:

```typescript
import { eq, and } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"
import { getGraphBaseUrl } from "./config"
import { metaFetch, type Fetcher } from "./graph-client"
import { classifyMetaError, type MetaErrorClass } from "./errors"
import {
  getDecryptedConnectionByClient,
  insertPublishAttempt,
  type DecryptedConnection,
} from "./repository"

type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export interface PublishDeps {
  fetcher: Fetcher
  now: Date
}

export interface PublishOk {
  ok: true
  metaPostId: string
}

export interface PublishErr {
  ok: false
  errorClass: MetaErrorClass | "precondition"
  errorCode: string | null
  errorMessage: string
}

export type PublishResult = PublishOk | PublishErr

interface PostWithPhoto {
  id: string
  clientId: string
  platform: "facebook" | "instagram"
  status: string
  content: string
  photoUrl: string | null
}

async function loadPostForPublish(
  db: Db,
  postId: string
): Promise<PostWithPhoto | null> {
  const rows = await db
    .select({
      id: schema.posts.id,
      clientId: schema.posts.clientId,
      platform: schema.posts.platform,
      status: schema.posts.status,
      content: schema.posts.content,
      photoUrl: schema.photos.blobUrl,
    })
    .from(schema.posts)
    .leftJoin(schema.photos, eq(schema.photos.id, schema.posts.photoId))
    .where(eq(schema.posts.id, postId))
    .limit(1)
  return rows[0] ?? null
}

function preconditionError(message: string): PublishErr {
  return {
    ok: false,
    errorClass: "precondition",
    errorCode: null,
    errorMessage: message,
  }
}

/**
 * Publish a single approved post to Meta. Always resolves with a
 * tagged result so callers can branch on `.ok`. On failure, the post
 * is marked `failed` with `publishError` set, and a `publish_attempts`
 * row is appended. On precondition failures (no connection, wrong
 * status), the post is left unchanged and no API call is made.
 */
export async function publishPostToMeta(
  db: Db,
  postId: string,
  deps: PublishDeps,
  attemptedBy: string
): Promise<PublishResult> {
  const post = await loadPostForPublish(db, postId)
  if (!post) return preconditionError("Post not found")
  if (post.status !== "approved") {
    return preconditionError(`Post is not approved (status=${post.status})`)
  }

  const connection = await getDecryptedConnectionByClient(db, post.clientId)
  if (!connection) {
    return preconditionError("Client has no Meta connection")
  }

  if (post.platform === "facebook") {
    return await publishFacebook(db, post, connection, deps, attemptedBy)
  }
  // Instagram path arrives in Task 6
  return preconditionError(`Platform ${post.platform} not yet implemented`)
}

async function publishFacebook(
  db: Db,
  post: PostWithPhoto,
  connection: DecryptedConnection,
  deps: PublishDeps,
  attemptedBy: string
): Promise<PublishResult> {
  const base = getGraphBaseUrl()
  const useImage = post.photoUrl !== null
  const path = useImage ? "photos" : "feed"
  const url = `${base}/${connection.pageId}/${path}`

  const params = new URLSearchParams({
    access_token: connection.accessToken,
    message: post.content,
  })
  if (useImage && post.photoUrl) {
    params.set("url", post.photoUrl)
  }

  const response = await metaFetch(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
    deps.fetcher
  )

  if (response.ok) {
    const body = response.body as { id?: string }
    const metaPostId = body?.id ?? null
    if (!metaPostId) {
      return await recordFailure(db, post.id, attemptedBy, response.durationMs, {
        class: "content-rejected",
        code: null,
        message: "Meta returned 2xx with no post id",
      })
    }
    return await recordSuccess(db, post.id, attemptedBy, response.durationMs, metaPostId, deps.now)
  }

  const classified = classifyMetaError({
    httpStatus: response.httpStatus,
    body: response.body,
  })
  return await recordFailure(db, post.id, attemptedBy, response.durationMs, classified)
}

async function recordSuccess(
  db: Db,
  postId: string,
  attemptedBy: string,
  durationMs: number,
  metaPostId: string,
  now: Date
): Promise<PublishOk> {
  await db
    .update(schema.posts)
    .set({ status: "published", publishedAt: now, publishError: null, updatedAt: now })
    .where(and(eq(schema.posts.id, postId), eq(schema.posts.status, "approved")))
  await insertPublishAttempt(db, {
    postId,
    attemptedBy,
    success: true,
    metaPostId,
    requestDurationMs: durationMs,
  })
  return { ok: true, metaPostId }
}

async function recordFailure(
  db: Db,
  postId: string,
  attemptedBy: string,
  durationMs: number,
  classified: { class: MetaErrorClass; code: string | null; message: string }
): Promise<PublishErr> {
  await db
    .update(schema.posts)
    .set({ status: "failed", publishError: classified.message, updatedAt: new Date() })
    .where(eq(schema.posts.id, postId))
  await insertPublishAttempt(db, {
    postId,
    attemptedBy,
    success: false,
    errorClass: classified.class,
    errorCode: classified.code,
    errorMessage: classified.message,
    requestDurationMs: durationMs,
  })
  return {
    ok: false,
    errorClass: classified.class,
    errorCode: classified.code,
    errorMessage: classified.message,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/meta/__tests__/publish.test.ts`
Expected: PASS — all Facebook-path tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/publish.ts src/lib/meta/__tests__/publish.test.ts
git commit -m "feat(meta): publisher core — facebook feed and photo posts"
```

---

## Task 6: Publish logic — Instagram path (two-step)

**Files:**
- Modify: `src/lib/meta/publish.ts`
- Modify: `src/lib/meta/__tests__/publish.test.ts`

**Spec reference:** §3d "Instagram path." Two-step:
1. `POST /{IG_USER_ID}/media` with `image_url` + `caption` → returns container `{id}`
2. `POST /{IG_USER_ID}/media_publish` with `creation_id=<container_id>` → returns final `{id}`

Constraints:
- IG **requires** a photo. Text-only IG posts cannot exist.
- The connection's `instagramBusinessId` must be non-null.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/meta/__tests__/publish.test.ts`:

```typescript
describe("publishPostToMeta — Instagram path", () => {
  it("performs the two-step container + publish flow", async () => {
    await seedTestPhoto(db, CLIENT_ID, "photo-ig-1")
    await seedApprovedPost({
      id: "post-ig-1",
      platform: "instagram",
      photoId: "photo-ig-1",
    })

    const calls: string[] = []
    const fetcher: Fetcher = async (url) => {
      calls.push(url)
      if (url.includes("/media_publish")) {
        return jsonResponse(200, { id: "IG_FINAL_999" })
      }
      if (url.includes("/media")) {
        return jsonResponse(200, { id: "CONTAINER_123" })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }

    const result = await publishPostToMeta(
      db,
      "post-ig-1",
      { fetcher, now: new Date() },
      "user-admin"
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.metaPostId).toBe("IG_FINAL_999")
    }
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain("/IG_1/media")
    expect(calls[0]).not.toContain("media_publish")
    expect(calls[1]).toContain("/IG_1/media_publish")
    expect(calls[1]).toContain("creation_id=CONTAINER_123")
  })

  it("fails fast when the post has no photo", async () => {
    await seedApprovedPost({ id: "post-ig-2", platform: "instagram" })

    const fetcher: Fetcher = async () => jsonResponse(200, { id: "x" })
    const result = await publishPostToMeta(
      db,
      "post-ig-2",
      { fetcher, now: new Date() },
      "user-admin"
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorClass).toBe("precondition")
      expect(result.errorMessage).toMatch(/photo required/i)
    }
    // Post stays approved (precondition, no API call)
    const [post] = await db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.id, "post-ig-2"))
    expect(post.status).toBe("approved")
  })

  it("fails fast when the connection has no instagramBusinessId", async () => {
    // Reconnect with no IG id
    await db.delete(schema.metaConnections).where(eq(schema.metaConnections.clientId, CLIENT_ID))
    await upsertConnection(db, {
      clientId: CLIENT_ID,
      pageId: "PAGE_1",
      pageName: "Café Test",
      instagramBusinessId: null,
      encryptedAccessToken: encryptToken("test-token"),
      grantedScopes: "pages_manage_posts",
    })
    await seedTestPhoto(db, CLIENT_ID, "photo-ig-3")
    await seedApprovedPost({
      id: "post-ig-3",
      platform: "instagram",
      photoId: "photo-ig-3",
    })

    const fetcher: Fetcher = async () => jsonResponse(200, { id: "x" })
    const result = await publishPostToMeta(
      db,
      "post-ig-3",
      { fetcher, now: new Date() },
      "user-admin"
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toMatch(/instagram/i)
    }
  })

  it("classifies a container-step failure correctly", async () => {
    await seedTestPhoto(db, CLIENT_ID, "photo-ig-4")
    await seedApprovedPost({
      id: "post-ig-4",
      platform: "instagram",
      photoId: "photo-ig-4",
    })

    const fetcher: Fetcher = async (url) => {
      if (url.includes("/media") && !url.includes("publish")) {
        return jsonResponse(400, {
          error: { code: 9004, message: "Image fetch failed" },
        })
      }
      return jsonResponse(200, { id: "should-not-reach" })
    }

    const result = await publishPostToMeta(
      db,
      "post-ig-4",
      { fetcher, now: new Date() },
      "user-admin"
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorClass).toBe("content-rejected")
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/meta/__tests__/publish.test.ts`
Expected: FAIL — Instagram tests fail because the platform branch still returns "not yet implemented."

- [ ] **Step 3: Implement the Instagram path**

In `src/lib/meta/publish.ts`, replace the body of `publishPostToMeta` from `if (post.platform === "facebook")` onward with:

```typescript
  if (post.platform === "facebook") {
    return await publishFacebook(db, post, connection, deps, attemptedBy)
  }
  if (post.platform === "instagram") {
    return await publishInstagram(db, post, connection, deps, attemptedBy)
  }
  return preconditionError(`Platform ${post.platform} not supported`)
}

async function publishInstagram(
  db: Db,
  post: PostWithPhoto,
  connection: DecryptedConnection,
  deps: PublishDeps,
  attemptedBy: string
): Promise<PublishResult> {
  if (!post.photoUrl) {
    return preconditionError("Instagram posts require a photo")
  }
  if (!connection.instagramBusinessId) {
    return preconditionError("Client's Meta connection has no Instagram account")
  }

  const base = getGraphBaseUrl()
  const igId = connection.instagramBusinessId
  const totalStartedAt = Date.now()

  // Step 1 — create the container
  const containerParams = new URLSearchParams({
    access_token: connection.accessToken,
    image_url: post.photoUrl,
    caption: post.content,
  })
  const containerResponse = await metaFetch(
    `${base}/${igId}/media`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: containerParams.toString(),
    },
    deps.fetcher
  )

  if (!containerResponse.ok) {
    const classified = classifyMetaError({
      httpStatus: containerResponse.httpStatus,
      body: containerResponse.body,
    })
    return await recordFailure(
      db,
      post.id,
      attemptedBy,
      Date.now() - totalStartedAt,
      classified
    )
  }

  const containerBody = containerResponse.body as { id?: string }
  const containerId = containerBody?.id
  if (!containerId) {
    return await recordFailure(db, post.id, attemptedBy, Date.now() - totalStartedAt, {
      class: "content-rejected",
      code: null,
      message: "Instagram container step returned 2xx with no id",
    })
  }

  // Step 2 — publish the container
  const publishParams = new URLSearchParams({
    access_token: connection.accessToken,
    creation_id: containerId,
  })
  const publishResponse = await metaFetch(
    `${base}/${igId}/media_publish`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: publishParams.toString(),
    },
    deps.fetcher
  )

  if (!publishResponse.ok) {
    const classified = classifyMetaError({
      httpStatus: publishResponse.httpStatus,
      body: publishResponse.body,
    })
    return await recordFailure(
      db,
      post.id,
      attemptedBy,
      Date.now() - totalStartedAt,
      classified
    )
  }

  const publishBody = publishResponse.body as { id?: string }
  const metaPostId = publishBody?.id
  if (!metaPostId) {
    return await recordFailure(db, post.id, attemptedBy, Date.now() - totalStartedAt, {
      class: "content-rejected",
      code: null,
      message: "Instagram publish step returned 2xx with no id",
    })
  }

  return await recordSuccess(
    db,
    post.id,
    attemptedBy,
    Date.now() - totalStartedAt,
    metaPostId,
    deps.now
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/meta/__tests__/publish.test.ts`
Expected: PASS — all Facebook + Instagram tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/publish.ts src/lib/meta/__tests__/publish.test.ts
git commit -m "feat(meta): publisher core — instagram two-step container/publish"
```

---

## Task 7: Status guard against double-publish

**Files:**
- Modify: `src/lib/meta/__tests__/publish.test.ts` (add one test)

**Spec reference:** §3d Step 5 — "The status guard prevents double-publishing." The guard is *already* implemented in Task 5's `recordSuccess` via `and(eq(id, postId), eq(status, "approved"))`. This task verifies it works.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/meta/__tests__/publish.test.ts`:

```typescript
describe("publishPostToMeta — status guard", () => {
  it("does not flip status when post is already published (race)", async () => {
    await seedApprovedPost({ id: "post-race", platform: "facebook" })
    // Simulate another publish having already won the race
    await db
      .update(schema.posts)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(schema.posts.id, "post-race"))

    const fetcher: Fetcher = async () => jsonResponse(200, { id: "META_X" })
    const result = await publishPostToMeta(
      db,
      "post-race",
      { fetcher, now: new Date() },
      "user-admin"
    )

    // Precondition check trips first — status is no longer 'approved'.
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorClass).toBe("precondition")
      expect(result.errorMessage).toMatch(/not approved/i)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it passes immediately**

Run: `npx vitest run src/lib/meta/__tests__/publish.test.ts`
Expected: PASS — the precondition check in `publishPostToMeta` already enforces this.

If the test FAILS, the precondition check from Task 5 was lost — restore the `post.status !== "approved"` guard.

- [ ] **Step 3: Commit**

```bash
git add src/lib/meta/__tests__/publish.test.ts
git commit -m "test(meta): verify status guard prevents double-publish race"
```

---

## Task 8: Queue read query — `src/lib/admin/queue.ts`

**Files:**
- Create: `src/lib/admin/queue.ts`
- Create: `src/lib/admin/__tests__/queue.test.ts`

**Spec reference:** §3e — "A page listing posts where `status = 'approved' AND publishedAt IS NULL`, sorted by `publishAt` ascending. Each row shows: business name, platform pill, scheduled time, content preview, photo thumbnail if present."

This task isolates the query so the page server component stays a thin renderer.

- [ ] **Step 1: Write the failing test**

Create `src/lib/admin/__tests__/queue.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, seedTestClient, seedTestPhoto, type TestDb } from "@/test/db"
import { getQueueItems } from "../queue"
import * as schema from "@/db/schema"

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
})

describe("getQueueItems", () => {
  it("returns an empty array when nothing is queued", async () => {
    await seedTestClient(db, "client-1")
    const items = await getQueueItems(db)
    expect(items).toEqual([])
  })

  it("returns approved-but-unpublished posts sorted by publishAt asc", async () => {
    await seedTestClient(db, "client-a")
    await seedTestClient(db, "client-b")

    await db.insert(schema.posts).values([
      {
        id: "p-late",
        clientId: "client-a",
        platform: "facebook",
        scheduledDate: "2026-05-20",
        status: "approved",
        content: "Late one",
        reasoning: "test",
        publishAt: new Date("2026-05-20T12:00:00Z"),
      },
      {
        id: "p-early",
        clientId: "client-b",
        platform: "instagram",
        scheduledDate: "2026-05-18",
        status: "approved",
        content: "Early one",
        reasoning: "test",
        publishAt: new Date("2026-05-18T09:00:00Z"),
      },
    ])

    const items = await getQueueItems(db)
    expect(items).toHaveLength(2)
    expect(items[0].postId).toBe("p-early")
    expect(items[1].postId).toBe("p-late")
    expect(items[0].businessName).toBe("Test Café")
    expect(items[0].platform).toBe("instagram")
  })

  it("excludes draft, rejected, published, and failed posts", async () => {
    await seedTestClient(db, "client-x")
    for (const [id, status] of [
      ["p-draft", "draft"],
      ["p-rejected", "rejected"],
      ["p-published", "published"],
      ["p-failed", "failed"],
    ] as const) {
      await db.insert(schema.posts).values({
        id,
        clientId: "client-x",
        platform: "facebook",
        scheduledDate: "2026-05-20",
        status,
        content: id,
        reasoning: "test",
      })
    }

    const items = await getQueueItems(db)
    expect(items).toEqual([])
  })

  it("includes the photo URL when the post has a photo", async () => {
    await seedTestClient(db, "client-p")
    await seedTestPhoto(db, "client-p", "photo-q")
    await db.insert(schema.posts).values({
      id: "p-photo",
      clientId: "client-p",
      platform: "instagram",
      scheduledDate: "2026-05-20",
      status: "approved",
      content: "with photo",
      reasoning: "test",
      photoId: "photo-q",
      publishAt: new Date("2026-05-20T10:00:00Z"),
    })

    const items = await getQueueItems(db)
    expect(items).toHaveLength(1)
    expect(items[0].photoUrl).toContain("photo-q")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/admin/__tests__/queue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/admin/queue.ts`:

```typescript
import { eq, and, isNull, asc } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"

type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export interface QueueItem {
  postId: string
  clientId: string
  businessName: string
  platform: "instagram" | "facebook"
  scheduledDate: string
  publishAt: Date | null
  content: string
  photoUrl: string | null
  hasMetaConnection: boolean
}

/**
 * Return all posts that are approved but not yet published, ordered by
 * publishAt ascending (soonest first). Joined with the client's business
 * name and (left-joined) photo URL.
 */
export async function getQueueItems(db: Db): Promise<QueueItem[]> {
  const rows = await db
    .select({
      postId: schema.posts.id,
      clientId: schema.posts.clientId,
      businessName: schema.clients.businessName,
      platform: schema.posts.platform,
      scheduledDate: schema.posts.scheduledDate,
      publishAt: schema.posts.publishAt,
      content: schema.posts.content,
      photoUrl: schema.photos.blobUrl,
      connectionId: schema.metaConnections.id,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.posts.clientId))
    .leftJoin(schema.photos, eq(schema.photos.id, schema.posts.photoId))
    .leftJoin(schema.metaConnections, eq(schema.metaConnections.clientId, schema.posts.clientId))
    .where(and(eq(schema.posts.status, "approved"), isNull(schema.posts.publishedAt)))
    .orderBy(asc(schema.posts.publishAt))

  return rows.map((row) => ({
    postId: row.postId,
    clientId: row.clientId,
    businessName: row.businessName,
    platform: row.platform,
    scheduledDate: row.scheduledDate,
    publishAt: row.publishAt,
    content: row.content,
    photoUrl: row.photoUrl,
    hasMetaConnection: row.connectionId !== null,
  }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/admin/__tests__/queue.test.ts`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/queue.ts src/lib/admin/__tests__/queue.test.ts
git commit -m "feat(admin): queue read query for approved-unpublished posts"
```

---

## Task 9: Server action — `publishPostNowAction`

**Files:**
- Create: `src/app/admin/queue/actions.ts`

**Spec reference:** §3e — "The server action wraps `publishPostToMeta` and reports back to the UI." Admin-only. Returns a serializable result.

No unit test for this file directly — it's a thin wrapper. The publisher tests cover the underlying logic. We will exercise it manually in the smoke test (Task 13).

- [ ] **Step 1: Create the server action**

Create `src/app/admin/queue/actions.ts`:

```typescript
"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { db } from "@/db"
import { publishPostToMeta } from "@/lib/meta/publish"

export interface PublishNowResult {
  ok: true
  metaPostId: string
}

export interface PublishNowErr {
  ok: false
  errorClass: string
  errorMessage: string
}

export type PublishNowActionResult = PublishNowResult | PublishNowErr

/**
 * Admin-only. Triggers publishing of a single approved post. Wraps
 * `publishPostToMeta` so the dependency on `fetch` is implicit (server)
 * and the result is reduced to a JSON-serializable shape for the
 * client component.
 */
export async function publishPostNowAction(
  postId: string
): Promise<PublishNowActionResult> {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    return { ok: false, errorClass: "auth", errorMessage: "Unauthorized" }
  }

  const result = await publishPostToMeta(
    db,
    postId,
    { fetcher: fetch, now: new Date() },
    session.user.id
  )

  revalidatePath("/admin/queue")

  if (result.ok) {
    return { ok: true, metaPostId: result.metaPostId }
  }
  return {
    ok: false,
    errorClass: result.errorClass,
    errorMessage: result.errorMessage,
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/queue/actions.ts
git commit -m "feat(admin): publishPostNowAction server action (admin-only)"
```

---

## Task 10: Client component — "Publish now" button

**Files:**
- Create: `src/components/admin/publish-button.tsx`

**Spec reference:** §3e — "Publish now button — calls publishPostAction server action. On success: the row vanishes. On failure: the row turns amber, shows the error message, exposes a Retry button."

Visual behavior (Aesthetic A — Operator console will apply when the Attention List builds; here we keep things sober but not styled yet — system font, traffic-light status only).

- [ ] **Step 1: Create the component**

Create `src/components/admin/publish-button.tsx`:

```typescript
"use client"

import { useState, useTransition } from "react"
import { publishPostNowAction, type PublishNowActionResult } from "@/app/admin/queue/actions"

interface PublishButtonProps {
  postId: string
  disabled?: boolean
  disabledReason?: string
}

type UiState =
  | { kind: "idle" }
  | { kind: "publishing" }
  | { kind: "error"; message: string }
  | { kind: "success"; metaPostId: string }

export function PublishButton({ postId, disabled, disabledReason }: PublishButtonProps) {
  const [state, setState] = useState<UiState>({ kind: "idle" })
  const [isPending, startTransition] = useTransition()

  function onClick() {
    setState({ kind: "publishing" })
    startTransition(async () => {
      const result: PublishNowActionResult = await publishPostNowAction(postId)
      if (result.ok) {
        setState({ kind: "success", metaPostId: result.metaPostId })
      } else {
        setState({ kind: "error", message: result.errorMessage })
      }
    })
  }

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        title={disabledReason}
        style={{ opacity: 0.5, cursor: "not-allowed" }}
      >
        Niet beschikbaar
      </button>
    )
  }

  if (state.kind === "success") {
    return <span style={{ color: "#15803d" }}>Geplaatst ({state.metaPostId})</span>
  }

  if (state.kind === "publishing" || isPending) {
    return <button type="button" disabled>Bezig met plaatsen…</button>
  }

  if (state.kind === "error") {
    return (
      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        <span style={{ color: "#b45309" }} title={state.message}>Mislukt: {state.message}</span>
        <button type="button" onClick={onClick}>Opnieuw proberen</button>
      </span>
    )
  }

  return (
    <button type="button" onClick={onClick}>Nu plaatsen</button>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/publish-button.tsx
git commit -m "feat(admin): publish-now client component with loading and error states"
```

---

## Task 11: Server component — `/admin/queue` page

**Files:**
- Create: `src/app/admin/queue/page.tsx`

**Spec reference:** §3e — page listing approved-but-unpublished posts. Each row shows: client, platform, scheduled time, content preview, photo thumbnail, Publish-now button.

Admin-only. Reuses `requireAdmin()` from `src/lib/authorization.ts`.

- [ ] **Step 1: Create the page**

Create `src/app/admin/queue/page.tsx`:

```typescript
import { redirect } from "next/navigation"
import Image from "next/image"
import { auth } from "@/lib/auth"
import { db } from "@/db"
import { getQueueItems, type QueueItem } from "@/lib/admin/queue"
import { PublishButton } from "@/components/admin/publish-button"

export const dynamic = "force-dynamic"

export default async function QueuePage() {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    redirect("/login")
  }

  const items = await getQueueItems(db)

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>
        Publicatie-wachtrij ({items.length})
      </h1>

      {items.length === 0 ? (
        <p style={{ color: "#888" }}>Geen goedgekeurde posts wachten op publicatie.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
          {items.map((item) => (
            <QueueRow key={item.postId} item={item} />
          ))}
        </ul>
      )}
    </main>
  )
}

function QueueRow({ item }: { item: QueueItem }) {
  const platformLabel = item.platform === "instagram" ? "IG" : "FB"
  const scheduled = item.publishAt
    ? formatRelative(item.publishAt)
    : item.scheduledDate

  return (
    <li
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: 4,
        padding: 12,
        display: "grid",
        gridTemplateColumns: "64px 1fr auto",
        gap: 12,
        alignItems: "center",
      }}
    >
      <div>
        {item.photoUrl ? (
          <Image
            src={item.photoUrl}
            alt=""
            width={64}
            height={64}
            style={{ objectFit: "cover", borderRadius: 4 }}
            unoptimized
          />
        ) : (
          <div
            style={{
              width: 64,
              height: 64,
              background: "#f3f3f3",
              borderRadius: 4,
              display: "grid",
              placeItems: "center",
              color: "#888",
              fontSize: 11,
            }}
          >
            geen foto
          </div>
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {item.businessName}{" "}
          <span style={{ fontSize: 11, color: "#888", fontWeight: 400 }}>
            {platformLabel} · {scheduled}
          </span>
        </div>
        <div
          style={{
            fontSize: 13,
            color: "#333",
            marginTop: 4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {item.content}
        </div>
      </div>
      <PublishButton
        postId={item.postId}
        disabled={!item.hasMetaConnection}
        disabledReason={item.hasMetaConnection ? undefined : "Client is niet verbonden met Meta"}
      />
    </li>
  )
}

function formatRelative(when: Date): string {
  const now = Date.now()
  const diffMs = when.getTime() - now
  const diffMin = Math.round(diffMs / 60_000)
  if (Math.abs(diffMin) < 60) return diffMin >= 0 ? `over ${diffMin}m` : `${-diffMin}m geleden`
  const diffHr = Math.round(diffMin / 60)
  if (Math.abs(diffHr) < 48) return diffHr >= 0 ? `over ${diffHr}u` : `${-diffHr}u geleden`
  return when.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })
}
```

Note: `unoptimized` on the Image is consistent with how Vercel Blob URLs are handled elsewhere in this codebase (matches `post-preview.tsx`'s pattern of using `eslint-disable next/next/no-img-element` per the code review). If Next image optimization is preferred and configured for the Blob domain, drop `unoptimized`.

- [ ] **Step 2: Verify it compiles and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: zero TS errors. ESLint may warn about Image usage — if so, swap to a plain `<img>` with an inline disable comment matching the project pattern (see `src/components/dashboard/post-preview.tsx`).

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/queue/page.tsx
git commit -m "feat(admin): /admin/queue page lists approved-unpublished posts"
```

---

## Task 12: Wire navigation to `/admin/queue`

**Files:**
- Modify: `src/app/admin/page.tsx` (or `src/app/admin/layout.tsx` if it exists)

**Spec reference:** §3e — the page must be reachable from Stefan's normal admin navigation, not just by typing the URL.

- [ ] **Step 1: Inspect the current admin layout/page**

Run: `ls src/app/admin/`
Read: `src/app/admin/page.tsx` and `src/app/admin/layout.tsx` if present.

- [ ] **Step 2: Add a queue link to admin navigation**

If a layout file exists with a nav element, add a link entry pointing to `/admin/queue` with the label "Wachtrij". If only `page.tsx` exists and it's a raw table, add a top-of-page link bar containing at least `Attention List (todo)`, `Clients`, `Queue`, `Generate preview`.

Minimal example to add to whichever file owns admin navigation:

```tsx
<nav style={{ display: "flex", gap: 16, padding: "8px 24px", borderBottom: "1px solid #e5e5e5" }}>
  <Link href="/admin">Overzicht</Link>
  <Link href="/admin/clients">Clients</Link>
  <Link href="/admin/queue">Wachtrij</Link>
</nav>
```

(Import `Link` from `next/link` if not already present.)

- [ ] **Step 3: Verify nothing broke**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/
git commit -m "feat(admin): nav link to publication queue"
```

---

## Task 13: Manual smoke test

**Files:** none (verification only). Document the result in the eventual PR body.

**Spec reference:** §4 "Integration smoke test (manual, post-deploy, Development Mode app)."

This task is the verification gate before opening a PR. Do not skip — Meta API quirks only surface against the real Graph endpoint.

- [ ] **Step 1: Confirm environment variables are set**

Required for the smoke test:

- `DATABASE_URL` — Neon dev
- `META_TOKEN_ENCRYPTION_KEY` — must be the same 32-byte base64 key used when the test client was connected
- `META_APP_ID`, `META_APP_SECRET`, `META_OAUTH_REDIRECT_URI` — from the existing #5a setup
- `AUTH_RESEND_KEY`, `AUTH_SECRET` — existing
- (Optional) `META_GRAPH_VERSION` — defaults to `v21.0`

Verify by running `npm run dev` and confirming no env-related startup error.

- [ ] **Step 2: Prepare a test post**

1. Sign in as admin (`admin@example.com`).
2. Confirm a test client (Café Test Arnhem, or similar) has an active Meta connection from the #5a flow.
3. Either run `npm run seed:cafe` to seed posts, or generate a fresh batch via the admin generate-preview tool.
4. Sign in as the client (or impersonate via the test flow) and approve at least one Facebook post and one Instagram post.

- [ ] **Step 3: Run the Facebook publish**

1. Visit `http://localhost:3000/admin/queue`.
2. Confirm the approved post(s) appear in the list, sorted by `publishAt`.
3. Click "Nu plaatsen" on the Facebook post.
4. Watch for: button state changes to "Bezig met plaatsen…", then either "Geplaatst (...)" or an error label.

**Expected on success:**
- The post leaves the queue on the next refresh.
- `SELECT status, publishedAt, publishError FROM posts WHERE id = '<post-id>'` shows `status='published'`, `publishedAt` set, `publishError=NULL`.
- `SELECT * FROM publish_attempts WHERE postId = '<post-id>'` shows one row with `success=true` and a non-null `metaPostId`.
- The Facebook page at https://facebook.com/<page> shows the new post within ~1 minute.

- [ ] **Step 4: Run the Instagram publish**

1. Click "Nu plaatsen" on the Instagram post.
2. The two-step container/publish flow happens server-side — there's no visible difference vs Facebook.

**Expected on success:**
- Same DB state changes as Facebook.
- The Instagram business account at https://instagram.com/<handle> shows the new post within ~1 minute.

- [ ] **Step 5: Force a failure to verify error path**

Pick an approved post and either:

- Approach A: temporarily corrupt the connection token in the DB:
  ```sql
  UPDATE meta_connections SET encryptedAccessToken = 'garbage' WHERE clientId = '<test-client-id>';
  ```
  Click "Nu plaatsen". Expect a decryption error to surface (the publisher will throw on `decryptToken`; the action returns an error string). Reset the token afterwards via the disconnect/reconnect flow.

- Approach B: edit the post content to contain something the IG validator rejects (e.g., extremely long caption). Click publish. Expect `status='failed'`, `publishError` set, and the queue row turns amber with an "Opnieuw proberen" button.

Capture the actual error message you see — it informs whether `errors.ts` needs more error-code mappings.

- [ ] **Step 6: Verify the build is green end-to-end**

Run: `npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
Expected: every command exits 0.

- [ ] **Step 7: Open the PR**

```bash
git push -u origin <branch>
gh pr create --title "feat(meta): publisher core — manual publish-from-queue" --body "$(cat <<'EOF'
## Summary
- Adds `publish_attempts` audit table
- Adds `src/lib/meta/{publish,errors,graph-client}.ts` for the core publish logic
- Adds `/admin/queue` page with "Publish now" buttons per approved post
- Covers Facebook (single-step) and Instagram (two-step container + publish) paths
- Tests use mocked `fetcher`; no real Meta API contact in CI

## Test plan
- [x] Unit tests pass (`npx vitest run`)
- [x] Type check passes (`npx tsc --noEmit`)
- [x] Build passes (`npm run build`)
- [x] Manual smoke: published a real test Facebook post (see attempt log)
- [x] Manual smoke: published a real test Instagram post (see attempt log)
- [x] Failure path verified (corrupted token → status=failed, publishError surfaced)

## Out of scope
- Auto-publish cron (Option B from the design spec) — deferred to 6–8 week migration to Option C
- Retry policy with backoff — manual "Opnieuw proberen" only in v1
- Token-expiry email alerts — picked up in publisher #5c follow-up
- Attention List integration — comes after this PR ships
EOF
)"
```

---

## Self-Review

**1. Spec coverage** (`docs/superpowers/specs/2026-05-12-publisher-design.md`)

| Spec section | Covered by |
|---|---|
| §1 "What we're building" — manual model | Tasks 9–11 (queue page + button + action) |
| §3a `publish_attempts` schema | Task 1 |
| §3d "publisher logic — Facebook path" | Task 5 |
| §3d "publisher logic — Instagram two-step" | Task 6 |
| §3d Step 5 "status guard" | Task 5 (implementation) + Task 7 (verification) |
| §3e UX — `/admin/queue` page | Tasks 9–11 |
| §3e UX — server action `publishPostNowAction` | Task 9 |
| §3g retry semantics — error classification | Task 2 (errors.ts) |
| §3g retry semantics — manual retry button | Task 10 (Opnieuw proberen) |
| §4 unit tests | Tasks 2–8 |
| §4 manual smoke test | Task 13 |

Explicit gaps vs spec, by design:
- §3b OAuth flow — already shipped (#5a)
- §3c token encryption — already shipped (#5a)
- §3f Option B auto-cron — out of scope per locked decision
- §3g retry classes "Transient: up to 5 retries with backoff" — v1 surfaces the error and lets Stefan click "Opnieuw proberen" manually. Auto-retry deferred to #5c.
- §3g "Send Stefan an email when token expires" — deferred to #5c. v1 surfaces `errorClass="token-expired"` in the queue UI.
- §5 "`src/lib/meta/client.ts`" — named `graph-client.ts` here to avoid clashing with the convention `client.ts` (Anthropic SDK already uses that name elsewhere in `src/lib/ai/client.ts`). Same responsibility.

**2. Placeholder scan** — none. Every code block is complete and runnable.

**3. Type consistency** — checked:
- `Fetcher`, `MetaFetchResult`, `MetaErrorClass`, `ClassifiedError`, `PublishDeps`, `PublishResult`, `PublishOk`, `PublishErr`, `DecryptedConnection`, `QueueItem`, `PublishNowActionResult` — all defined exactly once and used consistently downstream.
- The `Db` type alias is re-declared in each new file per repo convention, not imported.
- The `errorClass` field on `PublishErr` is `MetaErrorClass | "precondition"`; the action wrapper widens to `string` for client serialization. Documented inline.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-16-publisher-core.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
