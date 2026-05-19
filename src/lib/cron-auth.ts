import { timingSafeEqual } from "node:crypto"

/**
 * Verify a cron request's Authorization header against CRON_SECRET.
 * Uses timing-safe comparison to prevent character-by-character guessing.
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

  const expectedBuf = Buffer.from(expected)
  const actualBuf = Buffer.from(actual)

  if (expectedBuf.length !== actualBuf.length) {
    timingSafeEqual(expectedBuf, expectedBuf)
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) }
  }

  if (!timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) }
  }

  return { ok: true }
}
