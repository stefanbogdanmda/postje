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
  vi.restoreAllMocks()
  mockedAuth.mockResolvedValue({
    user: { id: "admin-1", role: "admin", email: "admin@example.com" },
  } as never)
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
