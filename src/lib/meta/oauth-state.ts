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
