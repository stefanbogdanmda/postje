# Publisher OAuth + Encrypted Token Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation for the Meta publisher path: a single admin can connect a client's Facebook Page + linked Instagram Business account through OAuth, and we store the resulting page access token encrypted at rest. No publishing logic, no scheduling, no queue UI — those are Plans #5b and #5c.

**Architecture:** A new `meta_connections` Postgres table holds one row per client × page combo with an encrypted access token, granted scopes, page id, IG business id, and validation timestamps. AES-256-GCM with a 32-byte key from `META_TOKEN_ENCRYPTION_KEY` env var. The OAuth flow: admin clicks "Connect" on `/admin/clients/[id]` → server action returns the Meta dialog URL with a signed HMAC state token that binds the OAuth round-trip to a specific client. After consent, Meta redirects to `/api/meta/callback`, which validates state, exchanges code for a short-lived user token, swaps it for a long-lived user token, fetches the user's pages, picks the first one (single-page assumption for v1), captures the linked IG Business id if present, encrypts the page token, and inserts the row. Disconnect is a server action that deletes the row.

**Tech Stack:** TypeScript, Next.js App Router, Drizzle ORM (Postgres), node:crypto (AES-256-GCM + HMAC-SHA256), Vitest + PGlite for tests. No new dependencies.

**Scope guard:** This plan does NOT touch publishing, scheduling, or the queue UI. If you find yourself about to write `publishPostToMeta` or `/api/cron/publish-due`, STOP — that's Plan #5b.

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `src/lib/meta/crypto.ts` | `encryptToken` / `decryptToken` using AES-256-GCM with a per-row IV. |
| `src/lib/meta/__tests__/crypto.test.ts` | Roundtrip, IV uniqueness, tampering detection. |
| `src/lib/meta/oauth-state.ts` | HMAC-signed, time-boxed state tokens binding the OAuth flow to a clientId. |
| `src/lib/meta/__tests__/oauth-state.test.ts` | Generate, validate, reject expired, reject tampered. |
| `src/lib/meta/config.ts` | OAuth scopes, default Graph version, dialog URL constants. |
| `src/lib/meta/oauth.ts` | `buildAuthUrl`, `exchangeCodeForToken`, `extendUserToken`, `fetchUserPages`. All take a `fetcher` for testability. |
| `src/lib/meta/__tests__/oauth.test.ts` | All four functions with a mocked fetcher. |
| `src/lib/meta/repository.ts` | DB queries: `getConnectionByClient`, `upsertConnection`, `deleteConnectionByClient`. Always filters by `clientId`. |
| `src/lib/meta/__tests__/repository.test.ts` | TDD against PGlite, two-client tenant-isolation checks. |
| `src/app/api/meta/connect/start/route.ts` | Admin-only GET — returns the OAuth dialog URL for a given `clientId`. |
| `src/app/api/meta/connect/start/__tests__/route.test.ts` | Auth gate, valid response shape, missing-clientId 400. |
| `src/app/api/meta/callback/route.ts` | Public GET — handles Meta's redirect, runs the full exchange, redirects back to client detail page. |
| `src/app/api/meta/callback/__tests__/route.test.ts` | Bad state, expired state, valid flow inserts a row, Meta-error path. |
| `src/app/admin/clients/[id]/meta-actions.ts` | Server actions: `getMetaConnectUrlAction(clientId)` and `disconnectMetaAction(clientId)`. |
| `src/components/admin/meta-connection-panel.tsx` | Connect button + status pill + disconnect-with-confirm. Mounted on the client detail page. |
| `src/db/migrations/0003_*.sql` | Auto-generated migration for `meta_connections`. |

### Modified files

| Path | Change |
|---|---|
| `src/db/schema.ts` | Add `metaConnections` table definition + export. |
| `src/app/admin/clients/[id]/page.tsx` | Read connection row, render `<MetaConnectionPanel>` below the edit form. |
| `.env.example` | Add the five new env vars with placeholder values + generation hints. |
| `docs/meta-setup.md` | Promote from untracked to tracked (no content changes). |

---

## Conventions to follow

- **Match `src/lib/posts/__tests__/repository.test.ts` patterns** — use `createTestDb` / `seedTestClient` from `src/test/db.ts`, `beforeEach` resets, two-client tenant-isolation checks where the function touches `clientId`.
- **Reuse the `Db` type alias** from `src/lib/posts/repository.ts` (or copy it verbatim if needed — there's already drift). Don't introduce a new type-alias home in this branch.
- **All exported functions get parameter + return types.** Repository functions take `db` first, then `clientId`, then anything else.
- **No `console.log` in production code paths.** Errors bubble to the route handler, which returns a redirect with a query-string error code.
- **Server actions use `"use server"` at the top and re-validate the admin session inside the action body.** Don't trust the client.
- **Don't read `.env*` files.** Reference env vars by `process.env.NAME`. Document new ones in `.env.example`.

---

## Task 1: Branch hygiene and seed context

**Files:**
- Stage: `docs/meta-setup.md`
- Modify: `.env.example`

- [ ] **Step 1: Confirm you're on the correct branch**

Run: `git branch --show-current`
Expected: `feat/publisher-oauth-tokens`

If wrong, stop. Don't push to main, don't touch `feat/attention-list` or `feat/gdpr-export-deletion`.

- [ ] **Step 2: Add new env vars to `.env.example`**

Edit `.env.example` and append at the bottom:

```
# Meta (Facebook + Instagram) OAuth — used by the publisher path
# Public app id from developers.facebook.com → Settings → Basic
META_APP_ID=
# Server-only app secret (rotate immediately if exposed)
META_APP_SECRET=
# Exact callback URL registered in Meta App settings → Facebook Login for Business
# Local dev: http://localhost:3000/api/meta/callback
# Production: https://<your-domain>/api/meta/callback
META_OAUTH_REDIRECT_URI=http://localhost:3000/api/meta/callback
# 32-byte AES-256-GCM key, base64-encoded.
# Generate locally: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# This is the encryption key for stored Meta access tokens. NEVER commit a real value.
META_TOKEN_ENCRYPTION_KEY=
# Graph API version. Defaults to v21.0 in code if not set.
META_GRAPH_VERSION=v21.0
```

- [ ] **Step 3: Commit the docs + env scaffold**

```bash
git add docs/meta-setup.md .env.example
git commit -m "docs(meta): track meta-setup guide and document oauth env vars"
```

---

## Task 2: `meta_connections` schema + migration

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/0003_*.sql` (auto-generated)

- [ ] **Step 1: Add the table definition to schema.ts**

Append after `deletionAuditLog` in `src/db/schema.ts`:

```typescript
// ──────────────────────────────────────────────
// metaConnections — encrypted Meta page-access-token storage.
// One active row per client per page. The encrypted token is decoded
// only inside the publisher; nothing else reads it.
// ──────────────────────────────────────────────
export const metaConnections = pgTable(
  "meta_connections",
  {
    id: text("id")
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    clientId: text("clientId")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    pageId: text("pageId").notNull(),
    pageName: text("pageName").notNull(),
    instagramBusinessId: text("instagramBusinessId"),
    encryptedAccessToken: text("encryptedAccessToken").notNull(),
    grantedScopes: text("grantedScopes").notNull(),
    connectedAt: timestamp("connectedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastValidatedAt: timestamp("lastValidatedAt", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("meta_connections_client_page_idx").on(t.clientId, t.pageId),
  ]
)
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `src/db/migrations/0003_<adjective>_<noun>.sql` is created, plus an updated `src/db/migrations/meta/_journal.json` and a new `0003_snapshot.json`.

Open the generated `.sql` and verify it includes:
- `CREATE TABLE "meta_connections" (...)`
- A FK from `clientId` to `clients.id` with `ON DELETE CASCADE`
- `CREATE UNIQUE INDEX "meta_connections_client_page_idx" ON "meta_connections" ("clientId", "pageId")`

- [ ] **Step 3: Apply locally to verify the migration is well-formed**

Run: `npm run db:migrate`
Expected: the migration applies cleanly (the dev Neon instance already has previous migrations).

- [ ] **Step 4: Run the existing test suite to confirm nothing regressed**

Run: `npm test -- --reporter=default`
Expected: all existing tests still pass (PGlite applies the new migration on every `createTestDb` call).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations
git commit -m "feat(meta): add meta_connections table for encrypted oauth tokens"
```

---

## Task 3: AES-256-GCM encryption module (TDD)

**Files:**
- Create: `src/lib/meta/crypto.ts`
- Create: `src/lib/meta/__tests__/crypto.test.ts`

**Why this design:** Each call generates a fresh 12-byte IV (recommended GCM IV length); ciphertext is encoded as `base64(iv || authTag || ciphertext)`. Tampering with any byte (auth tag, IV, or ciphertext) causes `decryptToken` to throw because `crypto.createDecipheriv` verifies the auth tag during `.final()`.

- [ ] **Step 1: Write the failing test file**

Create `src/lib/meta/__tests__/crypto.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { encryptToken, decryptToken } from "../crypto"

const TEST_KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" // 32 zero bytes

describe("encryptToken / decryptToken", () => {
  beforeEach(() => {
    process.env.META_TOKEN_ENCRYPTION_KEY = TEST_KEY_B64
  })

  it("roundtrips a token through encrypt and decrypt", () => {
    const plaintext = "EAAfake-page-token-1234567890"
    const ciphertext = encryptToken(plaintext)
    expect(ciphertext).not.toBe(plaintext)
    expect(decryptToken(ciphertext)).toBe(plaintext)
  })

  it("produces a different ciphertext on every call (fresh IV)", () => {
    const plaintext = "EAAfake-page-token"
    const a = encryptToken(plaintext)
    const b = encryptToken(plaintext)
    expect(a).not.toBe(b)
    expect(decryptToken(a)).toBe(plaintext)
    expect(decryptToken(b)).toBe(plaintext)
  })

  it("rejects tampered ciphertext (auth tag mismatch)", () => {
    const plaintext = "EAAfake-page-token"
    const ciphertext = encryptToken(plaintext)
    // Flip the last byte of the base64 payload
    const tampered = ciphertext.slice(0, -2) + (ciphertext.slice(-2) === "==" ? "AA" : "==")
    // Either decode fails or the auth tag verification fails — both throw.
    expect(() => decryptToken(tampered)).toThrow()
  })

  it("throws a clear error when META_TOKEN_ENCRYPTION_KEY is missing", () => {
    delete process.env.META_TOKEN_ENCRYPTION_KEY
    expect(() => encryptToken("anything")).toThrow(/META_TOKEN_ENCRYPTION_KEY/)
  })

  it("throws a clear error when the key is not 32 bytes after base64 decode", () => {
    process.env.META_TOKEN_ENCRYPTION_KEY = "dG9vc2hvcnQ=" // "tooshort", 8 bytes
    expect(() => encryptToken("anything")).toThrow(/32 bytes/)
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- src/lib/meta/__tests__/crypto.test.ts`
Expected: FAIL — module `../crypto` not found.

- [ ] **Step 3: Implement `src/lib/meta/crypto.ts`**

```typescript
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12 // GCM standard
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32 // AES-256

function loadKey(): Buffer {
  const raw = process.env.META_TOKEN_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      "META_TOKEN_ENCRYPTION_KEY is not set. Generate one with: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    )
  }
  const key = Buffer.from(raw, "base64")
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `META_TOKEN_ENCRYPTION_KEY must decode to 32 bytes (AES-256). Got ${key.length} bytes.`
    )
  }
  return key
}

/**
 * Encrypt a plaintext token. Returns a base64-encoded payload that
 * embeds the IV and GCM auth tag alongside the ciphertext.
 *
 * Layout: base64( IV(12) || authTag(16) || ciphertext )
 */
export function encryptToken(plaintext: string): string {
  const key = loadKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64")
}

/**
 * Decrypt a payload produced by `encryptToken`. Throws if the auth tag
 * does not verify (tampering, wrong key, corrupted bytes).
 */
export function decryptToken(payload: string): string {
  const key = loadKey()
  const buf = Buffer.from(payload, "base64")
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Encrypted payload is too short to be valid")
  }
  const iv = buf.subarray(0, IV_LENGTH)
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])
  return plaintext.toString("utf8")
}
```

- [ ] **Step 4: Run tests; they should all pass**

Run: `npm test -- src/lib/meta/__tests__/crypto.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/crypto.ts src/lib/meta/__tests__/crypto.test.ts
git commit -m "feat(meta): aes-256-gcm token encryption with auth-tag verification"
```

---

## Task 4: OAuth state token — HMAC signed, time-boxed (TDD)

**Files:**
- Create: `src/lib/meta/oauth-state.ts`
- Create: `src/lib/meta/__tests__/oauth-state.test.ts`

**Why this design:** A stateless CSRF guard. Payload `{ clientId, expiresAt, nonce }` is JSON-encoded, signed with HMAC-SHA256 using `AUTH_SECRET` (already in every environment), then base64url-encoded with the signature appended. No DB row needed; validation is pure-function. 10-minute TTL.

- [ ] **Step 1: Write the failing test file**

Create `src/lib/meta/__tests__/oauth-state.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { generateOAuthState, verifyOAuthState } from "../oauth-state"

beforeEach(() => {
  process.env.AUTH_SECRET = "test-auth-secret-do-not-use-in-prod"
})

describe("OAuth state token", () => {
  it("generates a token that decodes to the original clientId", () => {
    const token = generateOAuthState("client-123")
    const result = verifyOAuthState(token)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.clientId).toBe("client-123")
  })

  it("rejects a token whose signature was tampered", () => {
    const token = generateOAuthState("client-123")
    const tampered = token.slice(0, -2) + "AA"
    const result = verifyOAuthState(tampered)
    expect(result.ok).toBe(false)
  })

  it("rejects a token that has expired", () => {
    const now = Date.now()
    const token = generateOAuthState("client-123", new Date(now - 60_000), 30) // expired 30s ago
    const result = verifyOAuthState(token)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("expired")
  })

  it("rejects a malformed token", () => {
    expect(verifyOAuthState("not-a-real-token").ok).toBe(false)
    expect(verifyOAuthState("").ok).toBe(false)
  })

  it("produces a different token for the same clientId on consecutive calls", () => {
    const a = generateOAuthState("client-123")
    const b = generateOAuthState("client-123")
    expect(a).not.toBe(b)
  })

  it("rejects a token signed with a different AUTH_SECRET", () => {
    const token = generateOAuthState("client-123")
    process.env.AUTH_SECRET = "different-secret"
    expect(verifyOAuthState(token).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npm test -- src/lib/meta/__tests__/oauth-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/meta/oauth-state.ts`**

```typescript
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const DEFAULT_TTL_SECONDS = 10 * 60

interface StatePayload {
  clientId: string
  expiresAt: number // unix ms
  nonce: string
}

export type VerifyResult =
  | { ok: true; clientId: string }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" }

function getSecret(): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error("AUTH_SECRET is not set; required to sign OAuth state tokens")
  }
  return Buffer.from(secret, "utf8")
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64")
}

function sign(payloadBytes: Buffer): Buffer {
  return createHmac("sha256", getSecret()).update(payloadBytes).digest()
}

/**
 * Generate a signed, time-boxed state token. Token shape: `<base64url(json)>.<base64url(hmac)>`.
 * Pass `issuedAt` / `ttlSeconds` to control expiry (used by tests; otherwise defaults).
 */
export function generateOAuthState(
  clientId: string,
  issuedAt: Date = new Date(),
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): string {
  const payload: StatePayload = {
    clientId,
    expiresAt: issuedAt.getTime() + ttlSeconds * 1000,
    nonce: randomBytes(8).toString("hex"),
  }
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8")
  const sig = sign(payloadBytes)
  return `${base64url(payloadBytes)}.${base64url(sig)}`
}

/**
 * Verify a state token: signature must match, expiry must be in the future.
 * Returns a discriminated result so the caller can branch on the failure mode
 * for telemetry.
 */
export function verifyOAuthState(token: string, now: Date = new Date()): VerifyResult {
  const parts = token.split(".")
  if (parts.length !== 2) return { ok: false, reason: "malformed" }

  let payloadBytes: Buffer
  let sig: Buffer
  try {
    payloadBytes = fromBase64url(parts[0])
    sig = fromBase64url(parts[1])
  } catch {
    return { ok: false, reason: "malformed" }
  }

  const expected = sign(payloadBytes)
  if (expected.length !== sig.length || !timingSafeEqual(expected, sig)) {
    return { ok: false, reason: "bad-signature" }
  }

  let payload: StatePayload
  try {
    payload = JSON.parse(payloadBytes.toString("utf8")) as StatePayload
  } catch {
    return { ok: false, reason: "malformed" }
  }

  if (typeof payload.expiresAt !== "number" || payload.expiresAt < now.getTime()) {
    return { ok: false, reason: "expired" }
  }
  if (typeof payload.clientId !== "string" || payload.clientId.length === 0) {
    return { ok: false, reason: "malformed" }
  }

  return { ok: true, clientId: payload.clientId }
}
```

- [ ] **Step 4: Run tests — all should pass**

Run: `npm test -- src/lib/meta/__tests__/oauth-state.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/oauth-state.ts src/lib/meta/__tests__/oauth-state.test.ts
git commit -m "feat(meta): hmac-signed time-boxed oauth state tokens"
```

---

## Task 5: OAuth config constants

**Files:**
- Create: `src/lib/meta/config.ts`

- [ ] **Step 1: Create `src/lib/meta/config.ts`**

```typescript
/**
 * Permission scopes requested during the Meta OAuth dialog.
 * Order matches docs/meta-setup.md §10a so the consent dialog asks for
 * exactly the same set we manually grant during dev.
 */
export const META_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_metadata",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
] as const

/** Default Graph API version when META_GRAPH_VERSION is not set. */
export const DEFAULT_GRAPH_VERSION = "v21.0"

export function getGraphVersion(): string {
  return process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION
}

export function getGraphBaseUrl(): string {
  return `https://graph.facebook.com/${getGraphVersion()}`
}

/** OAuth dialog hostname (separate from graph.facebook.com). */
export function getOAuthDialogUrl(): string {
  return `https://www.facebook.com/${getGraphVersion()}/dialog/oauth`
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/meta/config.ts
git commit -m "feat(meta): oauth scope constants and graph api version helpers"
```

---

## Task 6: OAuth helpers — `buildAuthUrl` (TDD)

**Files:**
- Create: `src/lib/meta/oauth.ts`
- Create: `src/lib/meta/__tests__/oauth.test.ts`

- [ ] **Step 1: Write the failing test for `buildAuthUrl`**

Create `src/lib/meta/__tests__/oauth.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  buildAuthUrl,
  exchangeCodeForToken,
  extendUserToken,
  fetchUserPages,
  type Fetcher,
} from "../oauth"

beforeEach(() => {
  process.env.META_APP_ID = "APP_ID_TEST"
  process.env.META_APP_SECRET = "APP_SECRET_TEST"
  process.env.META_OAUTH_REDIRECT_URI = "http://localhost:3000/api/meta/callback"
  process.env.META_GRAPH_VERSION = "v21.0"
})

describe("buildAuthUrl", () => {
  it("includes client_id, redirect_uri, state, and the configured scopes", () => {
    const url = new URL(buildAuthUrl("STATE_TOKEN"))
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v21.0/dialog/oauth")
    expect(url.searchParams.get("client_id")).toBe("APP_ID_TEST")
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/meta/callback"
    )
    expect(url.searchParams.get("state")).toBe("STATE_TOKEN")
    expect(url.searchParams.get("response_type")).toBe("code")
    const scope = url.searchParams.get("scope")
    expect(scope).toContain("pages_manage_posts")
    expect(scope).toContain("instagram_content_publish")
  })

  it("throws when META_APP_ID is missing", () => {
    delete process.env.META_APP_ID
    expect(() => buildAuthUrl("x")).toThrow(/META_APP_ID/)
  })

  it("throws when META_OAUTH_REDIRECT_URI is missing", () => {
    delete process.env.META_OAUTH_REDIRECT_URI
    expect(() => buildAuthUrl("x")).toThrow(/META_OAUTH_REDIRECT_URI/)
  })
})
```

- [ ] **Step 2: Run — verify they fail**

Run: `npm test -- src/lib/meta/__tests__/oauth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/meta/oauth.ts` with `buildAuthUrl` only (more functions added in later tasks)**

```typescript
import { getGraphBaseUrl, getOAuthDialogUrl, META_OAUTH_SCOPES } from "./config"

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}

/**
 * Build the URL the admin's browser is redirected to in order to begin
 * the Meta OAuth flow. The `state` token is generated by oauth-state.ts
 * and binds this round-trip to a specific clientId.
 */
export function buildAuthUrl(state: string): string {
  const appId = requireEnv("META_APP_ID")
  const redirectUri = requireEnv("META_OAUTH_REDIRECT_URI")
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    scope: META_OAUTH_SCOPES.join(","),
  })
  return `${getOAuthDialogUrl()}?${params.toString()}`
}

// Placeholders that later tasks fill in. Keeping the exports declared so
// the test file can import them without "module has no exported member"
// errors during incremental development.
export async function exchangeCodeForToken(
  _code: string,
  _fetcher: Fetcher = globalThis.fetch
): Promise<{ accessToken: string; tokenType: string; expiresIn?: number }> {
  throw new Error("not implemented yet — see Task 7")
}

export async function extendUserToken(
  _shortLivedToken: string,
  _fetcher: Fetcher = globalThis.fetch
): Promise<{ accessToken: string; expiresIn: number }> {
  throw new Error("not implemented yet — see Task 8")
}

export interface MetaPage {
  id: string
  name: string
  accessToken: string
  instagramBusinessId: string | null
}

export async function fetchUserPages(
  _userAccessToken: string,
  _fetcher: Fetcher = globalThis.fetch
): Promise<MetaPage[]> {
  throw new Error("not implemented yet — see Task 9")
}

// Reference to silence "unused import" until later tasks wire it in.
export const _GRAPH_BASE = getGraphBaseUrl
```

- [ ] **Step 4: Run tests; only `buildAuthUrl` tests should pass**

Run: `npm test -- src/lib/meta/__tests__/oauth.test.ts -t "buildAuthUrl"`
Expected: PASS (3 tests). Other tests in this file still fail with "not implemented yet" — that's expected.

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/oauth.ts src/lib/meta/__tests__/oauth.test.ts
git commit -m "feat(meta): buildAuthUrl for the meta oauth dialog"
```

---

## Task 7: OAuth helper — `exchangeCodeForToken` (TDD)

**Files:**
- Modify: `src/lib/meta/oauth.ts`
- Modify: `src/lib/meta/__tests__/oauth.test.ts`

- [ ] **Step 1: Add the test cases**

Append to `src/lib/meta/__tests__/oauth.test.ts`:

```typescript
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("exchangeCodeForToken", () => {
  it("calls the graph access_token endpoint with the right params and returns the token", async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain("https://graph.facebook.com/v21.0/oauth/access_token")
      expect(url).toContain("client_id=APP_ID_TEST")
      expect(url).toContain("client_secret=APP_SECRET_TEST")
      expect(url).toContain("code=AUTHCODE")
      expect(url).toContain(
        "redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fmeta%2Fcallback"
      )
      return jsonResponse({
        access_token: "SHORT_LIVED_TOKEN",
        token_type: "bearer",
        expires_in: 3600,
      })
    })
    const result = await exchangeCodeForToken("AUTHCODE", fetcher)
    expect(result.accessToken).toBe("SHORT_LIVED_TOKEN")
    expect(result.tokenType).toBe("bearer")
    expect(result.expiresIn).toBe(3600)
  })

  it("throws a MetaApiError when graph returns a non-200", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        { error: { message: "Invalid verification code", code: 100, type: "OAuthException" } },
        400
      )
    )
    await expect(exchangeCodeForToken("BADCODE", fetcher)).rejects.toThrow(
      /Invalid verification code/
    )
  })

  it("throws when the response is 200 but body has no access_token", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ something_else: 1 }))
    await expect(exchangeCodeForToken("CODE", fetcher)).rejects.toThrow(/access_token/)
  })
})
```

- [ ] **Step 2: Run the new tests — verify they fail**

Run: `npm test -- src/lib/meta/__tests__/oauth.test.ts -t "exchangeCodeForToken"`
Expected: FAIL with "not implemented yet".

- [ ] **Step 3: Implement `exchangeCodeForToken` in `src/lib/meta/oauth.ts`**

Replace the placeholder `exchangeCodeForToken` with this implementation, and add the helper types/utilities below:

```typescript
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

async function readJsonOrThrow(res: Response): Promise<unknown> {
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
    const err = (body as { error?: { message?: string; code?: number; error_subcode?: number } })?.error
    throw new MetaApiError(
      err?.message ?? `Graph API error (status ${res.status})`,
      res.status,
      err?.code,
      err?.error_subcode
    )
  }
  return body
}

export async function exchangeCodeForToken(
  code: string,
  fetcher: Fetcher = globalThis.fetch
): Promise<{ accessToken: string; tokenType: string; expiresIn?: number }> {
  const appId = requireEnv("META_APP_ID")
  const appSecret = requireEnv("META_APP_SECRET")
  const redirectUri = requireEnv("META_OAUTH_REDIRECT_URI")
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  })
  const res = await fetcher(`${getGraphBaseUrl()}/oauth/access_token?${params.toString()}`)
  const body = (await readJsonOrThrow(res)) as {
    access_token?: string
    token_type?: string
    expires_in?: number
  }
  if (!body.access_token) {
    throw new MetaApiError("Graph response is missing access_token", res.status)
  }
  return {
    accessToken: body.access_token,
    tokenType: body.token_type ?? "bearer",
    expiresIn: body.expires_in,
  }
}
```

Also remove the now-unused `_GRAPH_BASE` placeholder export from Task 6 — `getGraphBaseUrl` is now used directly.

- [ ] **Step 4: Run tests — `buildAuthUrl` + `exchangeCodeForToken` should pass**

Run: `npm test -- src/lib/meta/__tests__/oauth.test.ts -t "exchangeCodeForToken"`
Expected: PASS (3 tests).

Run: `npm test -- src/lib/meta/__tests__/oauth.test.ts`
Expected: 6 passing tests; remaining tests in `extendUserToken` and `fetchUserPages` still fail (Tasks 8 + 9).

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/oauth.ts src/lib/meta/__tests__/oauth.test.ts
git commit -m "feat(meta): exchangeCodeForToken via graph oauth/access_token"
```

---

## Task 8: OAuth helper — `extendUserToken` (TDD)

**Files:**
- Modify: `src/lib/meta/oauth.ts`
- Modify: `src/lib/meta/__tests__/oauth.test.ts`

**Why this matters:** The code-exchange returns a 1-hour user token. Swapping it for a long-lived (~60-day) user token is what makes the derived **page** token effectively non-expiring (per `docs/meta-setup.md` §10c).

- [ ] **Step 1: Add tests for `extendUserToken`**

Append to `src/lib/meta/__tests__/oauth.test.ts`:

```typescript
describe("extendUserToken", () => {
  it("calls graph with grant_type=fb_exchange_token and returns the long-lived token", async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain("grant_type=fb_exchange_token")
      expect(url).toContain("client_id=APP_ID_TEST")
      expect(url).toContain("client_secret=APP_SECRET_TEST")
      expect(url).toContain("fb_exchange_token=SHORT_LIVED_TOKEN")
      return jsonResponse({
        access_token: "LONG_LIVED_TOKEN",
        token_type: "bearer",
        expires_in: 5_184_000, // 60 days
      })
    })
    const result = await extendUserToken("SHORT_LIVED_TOKEN", fetcher)
    expect(result.accessToken).toBe("LONG_LIVED_TOKEN")
    expect(result.expiresIn).toBe(5_184_000)
  })

  it("propagates a graph error as MetaApiError", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { message: "Invalid OAuth access token", code: 190 } }, 400)
    )
    await expect(extendUserToken("BADTOKEN", fetcher)).rejects.toThrow(
      /Invalid OAuth access token/
    )
  })
})
```

- [ ] **Step 2: Run — verify they fail**

Run: `npm test -- src/lib/meta/__tests__/oauth.test.ts -t "extendUserToken"`
Expected: FAIL — "not implemented yet".

- [ ] **Step 3: Replace the placeholder `extendUserToken` in `oauth.ts`**

```typescript
export async function extendUserToken(
  shortLivedToken: string,
  fetcher: Fetcher = globalThis.fetch
): Promise<{ accessToken: string; expiresIn: number }> {
  const appId = requireEnv("META_APP_ID")
  const appSecret = requireEnv("META_APP_SECRET")
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  })
  const res = await fetcher(`${getGraphBaseUrl()}/oauth/access_token?${params.toString()}`)
  const body = (await readJsonOrThrow(res)) as {
    access_token?: string
    expires_in?: number
  }
  if (!body.access_token) {
    throw new MetaApiError("Graph response is missing access_token", res.status)
  }
  return {
    accessToken: body.access_token,
    expiresIn: body.expires_in ?? 0,
  }
}
```

- [ ] **Step 4: Run tests — `extendUserToken` should pass**

Run: `npm test -- src/lib/meta/__tests__/oauth.test.ts -t "extendUserToken"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/oauth.ts src/lib/meta/__tests__/oauth.test.ts
git commit -m "feat(meta): extendUserToken swaps short-lived for long-lived user token"
```

---

## Task 9: OAuth helper — `fetchUserPages` (TDD)

**Files:**
- Modify: `src/lib/meta/oauth.ts`
- Modify: `src/lib/meta/__tests__/oauth.test.ts`

**Why this matters:** `me/accounts` returns the user's Pages, each with its own page-scoped `access_token`. The page token is what we store. For each page we also need to look up the linked Instagram Business id (separate call per page; only one extra call because v1 picks the first page).

- [ ] **Step 1: Add tests for `fetchUserPages`**

Append to `src/lib/meta/__tests__/oauth.test.ts`:

```typescript
describe("fetchUserPages", () => {
  it("returns the user's pages and the linked instagram business id when present", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("/me/accounts")) {
        expect(url).toContain("access_token=USER_TOKEN")
        return jsonResponse({
          data: [
            { id: "PAGE_1", name: "Café Test", access_token: "PAGE_TOKEN_1" },
            { id: "PAGE_2", name: "Other Page", access_token: "PAGE_TOKEN_2" },
          ],
        })
      }
      if (url.includes("/PAGE_1") && url.includes("instagram_business_account")) {
        return jsonResponse({ id: "PAGE_1", instagram_business_account: { id: "IG_1" } })
      }
      if (url.includes("/PAGE_2") && url.includes("instagram_business_account")) {
        return jsonResponse({ id: "PAGE_2" }) // no IG linked
      }
      throw new Error(`unexpected url: ${url}`)
    })

    const pages = await fetchUserPages("USER_TOKEN", fetcher)
    expect(pages).toHaveLength(2)
    expect(pages[0]).toEqual({
      id: "PAGE_1",
      name: "Café Test",
      accessToken: "PAGE_TOKEN_1",
      instagramBusinessId: "IG_1",
    })
    expect(pages[1].instagramBusinessId).toBeNull()
  })

  it("returns an empty array when the user has no pages", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ data: [] }))
    const pages = await fetchUserPages("USER_TOKEN", fetcher)
    expect(pages).toEqual([])
  })

  it("propagates graph errors as MetaApiError", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        { error: { message: "Invalid OAuth access token", code: 190 } },
        400
      )
    )
    await expect(fetchUserPages("BADTOKEN", fetcher)).rejects.toThrow(
      /Invalid OAuth access token/
    )
  })
})
```

- [ ] **Step 2: Run — verify they fail**

Run: `npm test -- src/lib/meta/__tests__/oauth.test.ts -t "fetchUserPages"`
Expected: FAIL — "not implemented yet".

- [ ] **Step 3: Replace the placeholder `fetchUserPages` in `oauth.ts`**

```typescript
export interface MetaPage {
  id: string
  name: string
  accessToken: string
  instagramBusinessId: string | null
}

export async function fetchUserPages(
  userAccessToken: string,
  fetcher: Fetcher = globalThis.fetch
): Promise<MetaPage[]> {
  const baseUrl = getGraphBaseUrl()
  const pagesParams = new URLSearchParams({ access_token: userAccessToken })
  const pagesRes = await fetcher(`${baseUrl}/me/accounts?${pagesParams.toString()}`)
  const pagesBody = (await readJsonOrThrow(pagesRes)) as {
    data?: Array<{ id: string; name: string; access_token: string }>
  }
  const rows = pagesBody.data ?? []

  // For each page, look up the linked Instagram Business account. We use
  // the page access token (not the user token) for this — page-scoped reads.
  const enriched: MetaPage[] = []
  for (const row of rows) {
    const igParams = new URLSearchParams({
      fields: "instagram_business_account",
      access_token: row.access_token,
    })
    const igRes = await fetcher(`${baseUrl}/${row.id}?${igParams.toString()}`)
    const igBody = (await readJsonOrThrow(igRes)) as {
      instagram_business_account?: { id: string }
    }
    enriched.push({
      id: row.id,
      name: row.name,
      accessToken: row.access_token,
      instagramBusinessId: igBody.instagram_business_account?.id ?? null,
    })
  }
  return enriched
}
```

- [ ] **Step 4: Run all oauth tests; verify they pass**

Run: `npm test -- src/lib/meta/__tests__/oauth.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/oauth.ts src/lib/meta/__tests__/oauth.test.ts
git commit -m "feat(meta): fetchUserPages with linked instagram business id lookup"
```

---

## Task 10: Repository for `meta_connections` (TDD)

**Files:**
- Create: `src/lib/meta/repository.ts`
- Create: `src/lib/meta/__tests__/repository.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/lib/meta/__tests__/repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { createTestDb, seedTestClient, type TestDb } from "@/test/db"
import {
  upsertConnection,
  getConnectionByClient,
  deleteConnectionByClient,
} from "../repository"

let db: TestDb
const CLIENT_ID = "test-client-001"
const OTHER_CLIENT = "other-client-002"

beforeEach(async () => {
  db = await createTestDb()
  await seedTestClient(db, CLIENT_ID)
})

function makeInput(overrides: Partial<{
  pageId: string
  pageName: string
  instagramBusinessId: string | null
  encryptedAccessToken: string
  grantedScopes: string
  expiresAt: Date | null
}> = {}) {
  return {
    clientId: CLIENT_ID,
    pageId: overrides.pageId ?? "PAGE_1",
    pageName: overrides.pageName ?? "Café Test",
    instagramBusinessId: overrides.instagramBusinessId ?? "IG_1",
    encryptedAccessToken: overrides.encryptedAccessToken ?? "encrypted-token-bytes",
    grantedScopes: overrides.grantedScopes ?? "pages_manage_posts,instagram_content_publish",
    expiresAt: overrides.expiresAt ?? null,
  }
}

describe("upsertConnection", () => {
  it("inserts a new connection row", async () => {
    await upsertConnection(db, makeInput())
    const found = await getConnectionByClient(db, CLIENT_ID)
    expect(found).not.toBeNull()
    expect(found!.pageId).toBe("PAGE_1")
    expect(found!.pageName).toBe("Café Test")
    expect(found!.instagramBusinessId).toBe("IG_1")
    expect(found!.encryptedAccessToken).toBe("encrypted-token-bytes")
  })

  it("replaces an existing row for the same (clientId, pageId)", async () => {
    await upsertConnection(db, makeInput({ encryptedAccessToken: "old" }))
    await upsertConnection(db, makeInput({ encryptedAccessToken: "new" }))
    const found = await getConnectionByClient(db, CLIENT_ID)
    expect(found!.encryptedAccessToken).toBe("new")
  })
})

describe("getConnectionByClient", () => {
  it("returns null when no connection exists", async () => {
    const found = await getConnectionByClient(db, CLIENT_ID)
    expect(found).toBeNull()
  })

  it("does not return another client's connection (tenant isolation)", async () => {
    await seedTestClient(db, OTHER_CLIENT)
    await upsertConnection(db, { ...makeInput(), clientId: OTHER_CLIENT })
    const found = await getConnectionByClient(db, CLIENT_ID)
    expect(found).toBeNull()
  })
})

describe("deleteConnectionByClient", () => {
  it("removes the row for this client", async () => {
    await upsertConnection(db, makeInput())
    await deleteConnectionByClient(db, CLIENT_ID)
    expect(await getConnectionByClient(db, CLIENT_ID)).toBeNull()
  })

  it("does not affect another client's connection (tenant isolation)", async () => {
    await seedTestClient(db, OTHER_CLIENT)
    await upsertConnection(db, makeInput())
    await upsertConnection(db, { ...makeInput(), clientId: OTHER_CLIENT })

    await deleteConnectionByClient(db, CLIENT_ID)

    expect(await getConnectionByClient(db, CLIENT_ID)).toBeNull()
    expect(await getConnectionByClient(db, OTHER_CLIENT)).not.toBeNull()
  })

  it("is a no-op when no row exists", async () => {
    await expect(deleteConnectionByClient(db, CLIENT_ID)).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: Run — verify they fail**

Run: `npm test -- src/lib/meta/__tests__/repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/meta/repository.ts`**

```typescript
import { eq, and } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"

type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export interface MetaConnection {
  id: string
  clientId: string
  pageId: string
  pageName: string
  instagramBusinessId: string | null
  encryptedAccessToken: string
  grantedScopes: string
  connectedAt: Date
  lastValidatedAt: Date | null
  expiresAt: Date | null
}

export interface UpsertConnectionInput {
  clientId: string
  pageId: string
  pageName: string
  instagramBusinessId: string | null
  encryptedAccessToken: string
  grantedScopes: string
  expiresAt?: Date | null
}

/**
 * Insert or replace a connection row for a (clientId, pageId) pair. If a
 * row already exists, its encrypted token + IG id + name are overwritten
 * and `connectedAt` is bumped to "now".
 */
export async function upsertConnection(
  db: Db,
  input: UpsertConnectionInput
): Promise<void> {
  const now = new Date()
  await db
    .insert(schema.metaConnections)
    .values({
      clientId: input.clientId,
      pageId: input.pageId,
      pageName: input.pageName,
      instagramBusinessId: input.instagramBusinessId,
      encryptedAccessToken: input.encryptedAccessToken,
      grantedScopes: input.grantedScopes,
      expiresAt: input.expiresAt ?? null,
      connectedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.metaConnections.clientId, schema.metaConnections.pageId],
      set: {
        pageName: input.pageName,
        instagramBusinessId: input.instagramBusinessId,
        encryptedAccessToken: input.encryptedAccessToken,
        grantedScopes: input.grantedScopes,
        expiresAt: input.expiresAt ?? null,
        connectedAt: now,
      },
    })
}

/**
 * Get the active connection for a client. v1 assumes one page per client;
 * if multiple rows exist (future multi-page support), returns the most
 * recently connected.
 */
export async function getConnectionByClient(
  db: Db,
  clientId: string
): Promise<MetaConnection | null> {
  const rows = await db
    .select()
    .from(schema.metaConnections)
    .where(eq(schema.metaConnections.clientId, clientId))
    .orderBy(schema.metaConnections.connectedAt)
    .limit(1)

  return (rows[0] as MetaConnection | undefined) ?? null
}

/**
 * Remove every connection row for this client. Used by the disconnect
 * action. The actual Meta access token is not revoked on Meta's side —
 * that would require a separate `DELETE /me/permissions` call which we
 * skip in v1 (tokens silently expire if unused).
 */
export async function deleteConnectionByClient(
  db: Db,
  clientId: string
): Promise<void> {
  await db
    .delete(schema.metaConnections)
    .where(eq(schema.metaConnections.clientId, clientId))
}
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `npm test -- src/lib/meta/__tests__/repository.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/repository.ts src/lib/meta/__tests__/repository.test.ts
git commit -m "feat(meta): repository for meta_connections with tenant isolation"
```

---

## Task 11: `/api/meta/connect/start` route — admin-only OAuth initiator

**Files:**
- Create: `src/app/api/meta/connect/start/route.ts`
- Create: `src/app/api/meta/connect/start/__tests__/route.test.ts`

**Why this design:** The Meta dialog URL is generated server-side so the state token never has to round-trip through the client unsigned. The route returns the URL as JSON; a server action consumes it and triggers a browser-side redirect.

- [ ] **Step 1: Write the failing route test**

Create `src/app/api/meta/connect/start/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}))

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(),
  },
}))

import { GET } from "../route"
import { auth } from "@/lib/auth"
import { db } from "@/db"

const mockedAuth = vi.mocked(auth)

beforeEach(() => {
  process.env.META_APP_ID = "APP_ID_TEST"
  process.env.META_APP_SECRET = "APP_SECRET_TEST"
  process.env.META_OAUTH_REDIRECT_URI = "http://localhost:3000/api/meta/callback"
  process.env.AUTH_SECRET = "test-secret"
  vi.clearAllMocks()
})

function reqWith(clientId: string | null) {
  const u = new URL("http://localhost/api/meta/connect/start")
  if (clientId !== null) u.searchParams.set("clientId", clientId)
  return new Request(u)
}

function adminSession() {
  return { user: { id: "admin-1", role: "admin", email: "admin@example.com" } } as never
}

function clientSession() {
  return { user: { id: "client-1", role: "client", email: "client@example.com" } } as never
}

describe("GET /api/meta/connect/start", () => {
  it("returns 401 when no session", async () => {
    mockedAuth.mockResolvedValue(null as never)
    const res = await GET(reqWith("client-abc"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when caller is not admin", async () => {
    mockedAuth.mockResolvedValue(clientSession())
    const res = await GET(reqWith("client-abc"))
    expect(res.status).toBe(403)
  })

  it("returns 400 when clientId is missing", async () => {
    mockedAuth.mockResolvedValue(adminSession())
    const res = await GET(reqWith(null))
    expect(res.status).toBe(400)
  })

  it("returns 404 when the client does not exist", async () => {
    mockedAuth.mockResolvedValue(adminSession())
    vi.mocked(db.select).mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    } as never)
    const res = await GET(reqWith("unknown-client"))
    expect(res.status).toBe(404)
  })

  it("returns a meta dialog URL with state for a valid admin call", async () => {
    mockedAuth.mockResolvedValue(adminSession())
    vi.mocked(db.select).mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [{ id: "client-abc" }] }) }),
    } as never)
    const res = await GET(reqWith("client-abc"))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string }
    expect(body.url).toContain("https://www.facebook.com/")
    expect(body.url).toContain("dialog/oauth")
    expect(body.url).toMatch(/state=/)
  })
})
```

- [ ] **Step 2: Run — verify they fail**

Run: `npm test -- src/app/api/meta/connect/start/__tests__/route.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement `src/app/api/meta/connect/start/route.ts`**

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/db"
import { clients } from "@/db/schema"
import { eq } from "drizzle-orm"
import { generateOAuthState } from "@/lib/meta/oauth-state"
import { buildAuthUrl } from "@/lib/meta/oauth"

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const url = new URL(req.url)
  const clientId = url.searchParams.get("clientId")
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 })
  }

  const rows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)

  if (rows.length === 0) {
    return NextResponse.json({ error: "client not found" }, { status: 404 })
  }

  const state = generateOAuthState(clientId)
  const dialogUrl = buildAuthUrl(state)
  return NextResponse.json({ url: dialogUrl })
}
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `npm test -- src/app/api/meta/connect/start/__tests__/route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/meta/connect/start
git commit -m "feat(meta): admin-only api route to start the oauth flow"
```

---

## Task 12: `/api/meta/callback` route — handle redirect, encrypt token, persist

**Files:**
- Create: `src/app/api/meta/callback/route.ts`
- Create: `src/app/api/meta/callback/__tests__/route.test.ts`

**Why this design:** The callback is the riskiest single piece of code in the flow. Everything that could go wrong does (bad state, expired state, Meta error, no pages, no IG link). All failure paths redirect back to the client detail page with a query-string error code; the UI surfaces a banner. Success redirects to the same page with `?meta=connected`.

The "single-page assumption" for v1: if the admin's account has zero pages, redirect with `?meta=error&reason=no-page`. If multiple, pick the first one and continue — document as a known limitation. Multi-page picker is Plan #5b/#5c territory.

- [ ] **Step 1: Write the failing callback test**

Create `src/app/api/meta/callback/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createTestDb, seedTestClient, type TestDb } from "@/test/db"
import { metaConnections } from "@/db/schema"
import { eq } from "drizzle-orm"

// auth() is mocked because we don't have a real session in tests.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))

// Swap the production `db` import for the per-test PGlite db.
let testDb: TestDb
vi.mock("@/db", () => ({
  get db() {
    return testDb
  },
}))

import { GET } from "../route"
import { auth } from "@/lib/auth"
import { generateOAuthState } from "@/lib/meta/oauth-state"
import { decryptToken } from "@/lib/meta/crypto"
import * as oauthModule from "@/lib/meta/oauth"

const mockedAuth = vi.mocked(auth)

const CLIENT_ID = "test-client-001"
const TEST_KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

beforeEach(async () => {
  process.env.META_APP_ID = "APP_ID_TEST"
  process.env.META_APP_SECRET = "APP_SECRET_TEST"
  process.env.META_OAUTH_REDIRECT_URI = "http://localhost:3000/api/meta/callback"
  process.env.AUTH_SECRET = "test-secret"
  process.env.META_TOKEN_ENCRYPTION_KEY = TEST_KEY_B64
  process.env.META_GRAPH_VERSION = "v21.0"
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000"

  testDb = await createTestDb()
  await seedTestClient(testDb, CLIENT_ID)
  mockedAuth.mockResolvedValue({
    user: { id: "admin-1", role: "admin", email: "admin@example.com" },
  } as never)
  vi.restoreAllMocks()
})

function callbackUrl(code: string, state: string) {
  const u = new URL("http://localhost/api/meta/callback")
  u.searchParams.set("code", code)
  u.searchParams.set("state", state)
  return new Request(u)
}

describe("GET /api/meta/callback", () => {
  it("redirects with error when state is missing", async () => {
    const u = new URL("http://localhost/api/meta/callback")
    u.searchParams.set("code", "ANY")
    const res = await GET(new Request(u))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toMatch(/meta=error/)
  })

  it("redirects with error when state is invalid", async () => {
    const res = await GET(callbackUrl("ANY", "not-a-valid-state-token"))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toMatch(/meta=error/)
  })

  it("redirects with error when state is expired", async () => {
    const expired = generateOAuthState(CLIENT_ID, new Date(Date.now() - 60_000), 30)
    const res = await GET(callbackUrl("ANY", expired))
    expect(res.headers.get("location")).toMatch(/meta=error/)
  })

  it("redirects with no-page error when graph returns zero pages", async () => {
    const state = generateOAuthState(CLIENT_ID)
    vi.spyOn(oauthModule, "exchangeCodeForToken").mockResolvedValue({
      accessToken: "SHORT", tokenType: "bearer", expiresIn: 3600,
    })
    vi.spyOn(oauthModule, "extendUserToken").mockResolvedValue({
      accessToken: "LONG", expiresIn: 5_184_000,
    })
    vi.spyOn(oauthModule, "fetchUserPages").mockResolvedValue([])

    const res = await GET(callbackUrl("CODE", state))
    expect(res.headers.get("location")).toMatch(/meta=error/)
    expect(res.headers.get("location")).toMatch(/no-page/)
  })

  it("stores an encrypted token and redirects on success", async () => {
    const state = generateOAuthState(CLIENT_ID)
    vi.spyOn(oauthModule, "exchangeCodeForToken").mockResolvedValue({
      accessToken: "SHORT", tokenType: "bearer", expiresIn: 3600,
    })
    vi.spyOn(oauthModule, "extendUserToken").mockResolvedValue({
      accessToken: "LONG", expiresIn: 5_184_000,
    })
    vi.spyOn(oauthModule, "fetchUserPages").mockResolvedValue([
      {
        id: "PAGE_1",
        name: "Café Test",
        accessToken: "PAGE_TOKEN_PLAINTEXT",
        instagramBusinessId: "IG_1",
      },
    ])

    const res = await GET(callbackUrl("CODE", state))
    expect(res.headers.get("location")).toMatch(/meta=connected/)
    expect(res.headers.get("location")).toContain(`/admin/clients/${CLIENT_ID}`)

    const rows = await testDb
      .select()
      .from(metaConnections)
      .where(eq(metaConnections.clientId, CLIENT_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].pageId).toBe("PAGE_1")
    expect(rows[0].instagramBusinessId).toBe("IG_1")
    // The stored token must NEVER be the plaintext.
    expect(rows[0].encryptedAccessToken).not.toBe("PAGE_TOKEN_PLAINTEXT")
    // And the encrypted value must decrypt back to the plaintext.
    expect(decryptToken(rows[0].encryptedAccessToken)).toBe("PAGE_TOKEN_PLAINTEXT")
  })

  it("redirects with error when meta exchange throws", async () => {
    const state = generateOAuthState(CLIENT_ID)
    vi.spyOn(oauthModule, "exchangeCodeForToken").mockRejectedValue(
      new Error("Invalid verification code")
    )
    const res = await GET(callbackUrl("BADCODE", state))
    expect(res.headers.get("location")).toMatch(/meta=error/)
  })
})
```

- [ ] **Step 2: Run — verify they fail**

Run: `npm test -- src/app/api/meta/callback/__tests__/route.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement `src/app/api/meta/callback/route.ts`**

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/db"
import { verifyOAuthState } from "@/lib/meta/oauth-state"
import {
  exchangeCodeForToken,
  extendUserToken,
  fetchUserPages,
} from "@/lib/meta/oauth"
import { encryptToken } from "@/lib/meta/crypto"
import { upsertConnection } from "@/lib/meta/repository"
import { META_OAUTH_SCOPES } from "@/lib/meta/config"

function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
}

function clientDetailUrl(clientId: string | null): URL {
  const u = new URL(appBaseUrl())
  u.pathname = clientId ? `/admin/clients/${clientId}` : "/admin"
  return u
}

function redirectWithError(clientId: string | null, reason: string): NextResponse {
  const u = clientDetailUrl(clientId)
  u.searchParams.set("meta", "error")
  u.searchParams.set("reason", reason)
  return NextResponse.redirect(u, 307)
}

function redirectSuccess(clientId: string): NextResponse {
  const u = clientDetailUrl(clientId)
  u.searchParams.set("meta", "connected")
  return NextResponse.redirect(u, 307)
}

export async function GET(req: Request): Promise<NextResponse> {
  // Belt + braces: callback is admin-only. State token already binds the
  // round-trip to a client, but we double-check the session role.
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return redirectWithError(null, "forbidden")
  }

  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")

  if (!code || !state) {
    return redirectWithError(null, "missing-params")
  }

  const verified = verifyOAuthState(state)
  if (!verified.ok) {
    return redirectWithError(null, verified.reason)
  }
  const clientId = verified.clientId

  try {
    const shortLived = await exchangeCodeForToken(code)
    const longLived = await extendUserToken(shortLived.accessToken)
    const pages = await fetchUserPages(longLived.accessToken)

    if (pages.length === 0) {
      return redirectWithError(clientId, "no-page")
    }

    // Single-page assumption for v1. Multi-page picker is Plan #5b/#5c.
    const page = pages[0]
    const encryptedAccessToken = encryptToken(page.accessToken)
    const expiresAt =
      longLived.expiresIn > 0
        ? new Date(Date.now() + longLived.expiresIn * 1000)
        : null

    await upsertConnection(db, {
      clientId,
      pageId: page.id,
      pageName: page.name,
      instagramBusinessId: page.instagramBusinessId,
      encryptedAccessToken,
      grantedScopes: META_OAUTH_SCOPES.join(","),
      expiresAt,
    })

    return redirectSuccess(clientId)
  } catch {
    // Don't surface the underlying error message to the client — could
    // leak token fragments or app secret context. The Attention List
    // (when 5c lands) will read meta_connections.lastErrorAt for telemetry.
    return redirectWithError(clientId, "meta-exchange-failed")
  }
}
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `npm test -- src/app/api/meta/callback/__tests__/route.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/meta/callback
git commit -m "feat(meta): oauth callback with encrypted token persistence"
```

---

## Task 13: Server actions — connect-start + disconnect

**Files:**
- Create: `src/app/admin/clients/[id]/meta-actions.ts`

**Why server actions:** The Connect button on the client detail page invokes a server action that calls the start endpoint internally (so we don't depend on a public `fetch` from the browser) and returns the dialog URL the client component then redirects to. Disconnect is a server action that deletes the connection row.

- [ ] **Step 1: Create `src/app/admin/clients/[id]/meta-actions.ts`**

```typescript
"use server"

import { auth } from "@/lib/auth"
import { db } from "@/db"
import { clients } from "@/db/schema"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { generateOAuthState } from "@/lib/meta/oauth-state"
import { buildAuthUrl } from "@/lib/meta/oauth"
import { deleteConnectionByClient } from "@/lib/meta/repository"

interface UrlResult {
  url?: string
  error?: string
}

interface DisconnectResult {
  ok?: true
  error?: string
}

/**
 * Build the Meta OAuth dialog URL for this client. The page calls this
 * server action and then `window.location.assign(url)` from the client
 * component. State is generated and signed here, server-side.
 */
export async function getMetaConnectUrlAction(
  clientId: string
): Promise<UrlResult> {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return { error: "Unauthorized" }
  }
  const rows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)
  if (rows.length === 0) {
    return { error: "Client not found" }
  }
  const state = generateOAuthState(clientId)
  return { url: buildAuthUrl(state) }
}

/**
 * Disconnect Meta for this client. Deletes the meta_connections row.
 * Does NOT revoke the access token on Meta's side — see repository.ts
 * for the rationale.
 */
export async function disconnectMetaAction(
  clientId: string
): Promise<DisconnectResult> {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return { error: "Unauthorized" }
  }
  await deleteConnectionByClient(db, clientId)
  revalidatePath(`/admin/clients/${clientId}`)
  return { ok: true }
}
```

- [ ] **Step 2: Type-check the new server action file**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/clients/[id]/meta-actions.ts
git commit -m "feat(meta): server actions for connect-start and disconnect"
```

---

## Task 14: UI — `<MetaConnectionPanel>` component + mount on client detail

**Files:**
- Create: `src/components/admin/meta-connection-panel.tsx`
- Modify: `src/app/admin/clients/[id]/page.tsx`

**Aesthetic:** Match the Operator Console direction. Use the `--admin-*` CSS variables from `src/styles/admin-tokens.css` (loaded by `src/app/admin/layout.tsx`). Sober, near-white, severity-only color. Status pill: gray when not connected, dark gray when connected.

- [ ] **Step 1: Create the panel component**

Create `src/components/admin/meta-connection-panel.tsx`:

```typescript
"use client"

import { useState, useTransition } from "react"
import {
  getMetaConnectUrlAction,
  disconnectMetaAction,
} from "@/app/admin/clients/[id]/meta-actions"

interface ConnectedState {
  pageName: string
  instagramBusinessId: string | null
  connectedAt: Date
}

interface MetaConnectionPanelProps {
  clientId: string
  connection: ConnectedState | null
  flashKind: "connected" | "error" | null
  flashReason: string | null
}

const errorReasonText: Record<string, string> = {
  "no-page": "Het gekoppelde Facebook-account heeft geen Pagina.",
  "meta-exchange-failed": "Meta gaf een fout terug tijdens het koppelen.",
  expired: "De koppellink is verlopen. Probeer het opnieuw.",
  "bad-signature": "De koppellink is ongeldig. Probeer het opnieuw.",
  malformed: "De koppellink kon niet worden gelezen.",
  "missing-params": "De koppeling werd onderbroken voordat Meta klaar was.",
  forbidden: "Je hebt geen toegang tot deze actie.",
}

export default function MetaConnectionPanel({
  clientId,
  connection,
  flashKind,
  flashReason,
}: MetaConnectionPanelProps) {
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleConnect() {
    setErrorMsg(null)
    const result = await getMetaConnectUrlAction(clientId)
    if (result.error || !result.url) {
      setErrorMsg(result.error ?? "Kon de koppeling niet starten.")
      return
    }
    window.location.assign(result.url)
  }

  function handleDisconnect() {
    setErrorMsg(null)
    startTransition(async () => {
      const result = await disconnectMetaAction(clientId)
      if (result.error) {
        setErrorMsg(result.error)
      }
      setConfirming(false)
    })
  }

  const containerStyle: React.CSSProperties = {
    border: "1px solid var(--admin-border)",
    backgroundColor: "var(--admin-surface)",
    borderRadius: "6px",
    padding: "20px 24px",
    marginTop: "24px",
  }
  const headerStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "12px",
  }
  const titleStyle: React.CSSProperties = {
    fontSize: "14px",
    fontWeight: 600,
    color: "var(--admin-text)",
    margin: 0,
  }
  const pillStyle = (connected: boolean): React.CSSProperties => ({
    fontSize: "12px",
    padding: "3px 10px",
    borderRadius: "999px",
    border: `1px solid ${connected ? "var(--admin-border-strong)" : "var(--admin-border)"}`,
    backgroundColor: connected ? "var(--admin-bg)" : "transparent",
    color: connected ? "var(--admin-text)" : "var(--admin-text-subtle)",
  })
  const buttonStyle: React.CSSProperties = {
    padding: "8px 14px",
    fontSize: "13px",
    border: "1px solid var(--admin-border-strong)",
    borderRadius: "4px",
    backgroundColor: "var(--admin-surface)",
    color: "var(--admin-text)",
    cursor: "pointer",
  }
  const dangerStyle: React.CSSProperties = {
    ...buttonStyle,
    color: "var(--admin-sev-critical)",
    borderColor: "var(--admin-sev-critical)",
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h2 style={titleStyle}>Meta connection</h2>
        <span style={pillStyle(connection !== null)}>
          {connection ? "Connected" : "Not connected"}
        </span>
      </div>

      {flashKind === "connected" && (
        <p
          style={{
            color: "var(--admin-text-muted)",
            fontSize: "13px",
            marginTop: 0,
          }}
        >
          Verbonden met Meta. Tokens zijn versleuteld opgeslagen.
        </p>
      )}
      {flashKind === "error" && (
        <p
          style={{
            color: "var(--admin-sev-critical)",
            fontSize: "13px",
            marginTop: 0,
          }}
        >
          {errorReasonText[flashReason ?? ""] ?? "Er ging iets mis bij het koppelen."}
        </p>
      )}
      {errorMsg && (
        <p style={{ color: "var(--admin-sev-critical)", fontSize: "13px" }}>{errorMsg}</p>
      )}

      {connection ? (
        <>
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "max-content 1fr",
              columnGap: "16px",
              rowGap: "6px",
              fontSize: "13px",
              color: "var(--admin-text-muted)",
              margin: "8px 0 16px 0",
            }}
          >
            <dt>Facebook Page</dt>
            <dd style={{ color: "var(--admin-text)", margin: 0 }}>
              {connection.pageName}
            </dd>
            <dt>Instagram</dt>
            <dd style={{ color: "var(--admin-text)", margin: 0 }}>
              {connection.instagramBusinessId
                ? `Linked (${connection.instagramBusinessId})`
                : "Not linked"}
            </dd>
            <dt>Connected</dt>
            <dd style={{ color: "var(--admin-text)", margin: 0 }}>
              {connection.connectedAt.toLocaleString("nl-NL")}
            </dd>
          </dl>

          {confirming ? (
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={pending}
                style={dangerStyle}
              >
                {pending ? "Disconnecting..." : "Confirm disconnect"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                style={buttonStyle}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              style={dangerStyle}
            >
              Disconnect Meta
            </button>
          )}
        </>
      ) : (
        <>
          <p
            style={{
              fontSize: "13px",
              color: "var(--admin-text-muted)",
              marginTop: 0,
            }}
          >
            Connect this client&apos;s Facebook Page and linked Instagram Business
            account so the publisher can post on their behalf. You will sign in
            to Facebook with the admin account that manages this Page.
          </p>
          <button type="button" onClick={handleConnect} style={buttonStyle}>
            Connect Instagram / Facebook
          </button>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Mount the panel on the client detail page**

Modify `src/app/admin/clients/[id]/page.tsx`. Replace the existing implementation with:

```typescript
import { auth } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import { db } from "@/db"
import { clients, users } from "@/db/schema"
import { eq } from "drizzle-orm"
import Link from "next/link"
import EditClientForm from "./edit-client-form"
import MetaConnectionPanel from "@/components/admin/meta-connection-panel"
import { getConnectionByClient } from "@/lib/meta/repository"

interface EditClientPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ meta?: string; reason?: string }>
}

export default async function EditClientPage({
  params,
  searchParams,
}: EditClientPageProps) {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    redirect("/login")
  }

  const { id } = await params
  const sp = await searchParams

  const [clientRows, connection] = await Promise.all([
    db
      .select({
        id: clients.id,
        businessName: clients.businessName,
        location: clients.location,
        industry: clients.industry,
        businessType: clients.businessType,
        productsServices: clients.productsServices,
        logoUrl: clients.logoUrl,
        email: users.email,
        hasLoggedIn: users.hasLoggedIn,
      })
      .from(clients)
      .innerJoin(users, eq(clients.userId, users.id))
      .where(eq(clients.id, id))
      .limit(1),
    getConnectionByClient(db, id),
  ])
  const client = clientRows[0]
  if (!client) {
    notFound()
  }

  const flashKind: "connected" | "error" | null =
    sp.meta === "connected" ? "connected" : sp.meta === "error" ? "error" : null

  return (
    <main style={{ padding: "32px", maxWidth: "640px" }}>
      <div style={{ marginBottom: "24px" }}>
        <Link
          href="/admin/clients"
          style={{ color: "#666", fontSize: "13px", textDecoration: "none" }}
        >
          ← Back to clients
        </Link>
      </div>

      <EditClientForm
        clientId={client.id}
        email={client.email}
        businessName={client.businessName}
        location={client.location}
        industry={client.industry}
        businessType={client.businessType}
        productsServices={client.productsServices}
        logoUrl={client.logoUrl}
        hasLoggedIn={client.hasLoggedIn}
      />

      <MetaConnectionPanel
        clientId={client.id}
        connection={
          connection
            ? {
                pageName: connection.pageName,
                instagramBusinessId: connection.instagramBusinessId,
                connectedAt: connection.connectedAt,
              }
            : null
        }
        flashKind={flashKind}
        flashReason={sp.reason ?? null}
      />
    </main>
  )
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Run the full test suite — nothing should regress**

Run: `npm test`
Expected: all tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/meta-connection-panel.tsx src/app/admin/clients/[id]/page.tsx
git commit -m "feat(meta): connect/disconnect panel on client detail page"
```

---

## Task 15: Final verification + PR body draft

**Files:**
- Create: `.pr-body-publisher-oauth-tokens.md`

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: build succeeds. Common gotcha: the callback route uses `redirect(307)` and reads `searchParams`; both are fine in Next 16 App Router but watch for missed dynamic-route configuration.

- [ ] **Step 2: Full test run**

Run: `npm test`
Expected: ALL tests pass. Count should be (previous count) + roughly 26 new tests:
- crypto: 5
- oauth-state: 6
- oauth (buildAuthUrl + exchange + extend + fetchPages): 11
- repository: 7
- start route: 5
- callback route: 6
- *(rounded ≈ 40 new tests; exact count depends on shared describe blocks)*

If a test fails, do NOT push. Diagnose first. Common gotchas:
- `vi.mock` factory must return objects with the exact shape the production module exports.
- The `db` mock in the callback test uses a per-test PGlite instance; the production `src/db/index.ts` reads `DATABASE_URL` at import time, which the mock factory short-circuits.

- [ ] **Step 3: Write the PR body draft**

Create `.pr-body-publisher-oauth-tokens.md`:

```markdown
## Summary

First half of the publisher path (Plan #5a from the publisher design spec). Lays
down the foundation so future PRs can actually publish posts to Meta.

- New `meta_connections` Postgres table — one row per client × Facebook Page,
  storing the page access token encrypted with AES-256-GCM.
- AES-256-GCM encryption helpers (`src/lib/meta/crypto.ts`) using only
  `node:crypto`. Key from `META_TOKEN_ENCRYPTION_KEY` env var. Auth-tag
  verification on every decrypt.
- HMAC-signed, 10-minute-TTL OAuth state tokens that bind the round-trip to
  a specific `clientId` (`src/lib/meta/oauth-state.ts`).
- OAuth helpers (`src/lib/meta/oauth.ts`): build dialog URL, exchange code
  for token, extend to long-lived user token, fetch user pages + linked IG
  Business id. All HTTP-mocked in tests.
- Two API routes:
  - `GET /api/meta/connect/start` (admin-only) — returns the dialog URL.
  - `GET /api/meta/callback` — handles Meta's redirect, runs the full
    exchange, persists the encrypted page token, redirects back to the
    client detail page with a status flash.
- Server actions `getMetaConnectUrlAction` and `disconnectMetaAction` on
  the client detail page.
- New `<MetaConnectionPanel>` UI on `/admin/clients/[id]` — Connect button,
  connected/disconnected status pill, disconnect-with-confirmation.

What is NOT in this PR (deliberate — separate plans):
- No publishing logic (`publishPostToMeta`) — Plan #5b.
- No `/admin/queue` UI — Plan #5b.
- No publish-attempts table or retry logic — Plan #5b / #5c.
- No multi-page picker — v1 picks the first page returned by `me/accounts`.

## Required env vars (new)

| Name | Notes |
|---|---|
| `META_APP_ID` | Public app id from developers.facebook.com. |
| `META_APP_SECRET` | Server-only. Rotate immediately if exposed. |
| `META_OAUTH_REDIRECT_URI` | Must match the URL registered in the Meta App's Facebook Login settings. Local: `http://localhost:3000/api/meta/callback`. |
| `META_TOKEN_ENCRYPTION_KEY` | 32-byte AES-256-GCM key, base64-encoded. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `META_GRAPH_VERSION` | Optional. Defaults to `v21.0`. |

Set these in Vercel (Production + Preview) before merging. Local `.env.local`
gets a generated dev encryption key (see `.env.example`).

## Test plan

- [ ] `npm test` — full suite green.
- [ ] `npm run build` — production build succeeds.
- [ ] Set all env vars locally and run `npm run dev`.
- [ ] On `/admin/clients/<existing-client-id>`, the new Meta connection panel
      shows "Not connected" with a Connect button.
- [ ] Click Connect → Meta OAuth dialog opens. Approve.
- [ ] You are redirected back to `/admin/clients/<id>?meta=connected`. Panel
      now shows "Connected" with Page name, IG link status, connected timestamp.
- [ ] Check Drizzle Studio (`npm run db:studio`) — `meta_connections` row
      exists; `encryptedAccessToken` is NOT the plaintext value from
      `docs/meta-setup.md`.
- [ ] Click "Disconnect Meta" → confirmation appears → click "Confirm
      disconnect" → panel returns to "Not connected" state. Row deleted.
- [ ] Force an error: edit the state token URL parameter, retry callback →
      banner shows "De koppellink is ongeldig."

## Out-of-scope reminders

- Multi-page admin accounts: v1 picks the first page. Document this if the
  test admin owns more than one Page.
- Meta App is still in Development Mode — only added testers can complete
  the OAuth flow. App Review submission is a separate workstream.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Final type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Push the branch**

Run: `git push -u origin feat/publisher-oauth-tokens`
Expected: branch published. PR creation URL is shown.

- [ ] **Step 6: Commit the PR body**

```bash
git add .pr-body-publisher-oauth-tokens.md
git commit -m "docs: PR body draft for publisher oauth tokens"
git push
```

---

## Self-Review Checklist

After all tasks land, re-read the spec sections that drove this plan and verify each requirement is implemented:

- [ ] **Spec §3a — schema:** `meta_connections` table exists with `clientId` FK + cascade, `encryptedAccessToken`, `pageId`, `pageName`, `instagramBusinessId`, `grantedScopes`, `connectedAt`, `expiresAt`, `lastValidatedAt`, unique index on `(clientId, pageId)`. **Task 2.**
- [ ] **Spec §3b — OAuth flow:** dialog URL builder, code-for-token exchange, long-lived swap, `me/accounts` + IG lookup, encrypt + insert. **Tasks 6, 7, 8, 9, 12.**
- [ ] **Spec §3c — encryption:** AES-256-GCM, per-row IV, auth tag verified. Key from env var. Refuses to run if key missing or wrong length. **Task 3.**
- [ ] **§5a scope guard — no publishing:** No `publishPostToMeta`, no `publish_attempts` table, no `/admin/queue`, no cron route. ✅
- [ ] **Hard rule — no unencrypted tokens at rest:** the page token is encrypted *inside the callback handler* before `upsertConnection`. ✅
- [ ] **Hard rule — admin-only:** start route requires `session.user.role === "admin"`; server actions re-check role; callback double-checks. ✅
- [ ] **Hard rule — mock Meta in tests:** all OAuth tests use `Fetcher` mocks. No real Graph API calls. ✅
- [ ] **Hard rule — no hardcoded app ids/secrets:** every Meta env var is referenced by name; no test value is a real credential. ✅

If any item is missing, add a task and implement it before requesting review.
