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
