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
