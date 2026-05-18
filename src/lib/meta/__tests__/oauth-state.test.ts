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
