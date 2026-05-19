import { NextResponse } from "next/server"
import { db } from "@/db"
import { metaConnections } from "@/db/schema"
import { and, lt, isNotNull, eq } from "drizzle-orm"
import { verifyCronSecret } from "@/lib/cron-auth"
import { decryptToken, encryptToken } from "@/lib/meta/crypto"
import { extendUserToken } from "@/lib/meta/oauth"

export const maxDuration = 120

/**
 * Refresh Meta page access tokens that expire within the next 7 days.
 * Runs daily. Tokens that fail to refresh are logged but not removed —
 * they'll show up as permanent-token errors in publish_attempts when
 * the publisher tries to use them.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization")
  const cronAuth = verifyCronSecret(authHeader)
  if (!cronAuth.ok) return cronAuth.response

  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  // Find connections with tokens expiring in the next 7 days
  const expiring = await db
    .select({
      id: metaConnections.id,
      clientId: metaConnections.clientId,
      encryptedAccessToken: metaConnections.encryptedAccessToken,
      expiresAt: metaConnections.expiresAt,
    })
    .from(metaConnections)
    .where(
      and(
        isNotNull(metaConnections.expiresAt),
        lt(metaConnections.expiresAt, sevenDaysFromNow)
      )
    )
    .limit(50)

  const results: Array<{
    connectionId: string
    clientId: string
    success: boolean
    error?: string
  }> = []

  for (const conn of expiring) {
    try {
      const currentToken = decryptToken(conn.encryptedAccessToken)
      const extended = await extendUserToken(currentToken)

      // Calculate new expiry (extendUserToken returns expiresIn in seconds)
      const newExpiresAt = new Date(
        Date.now() + extended.expiresIn * 1000
      )

      await db
        .update(metaConnections)
        .set({
          encryptedAccessToken: encryptToken(extended.accessToken),
          expiresAt: newExpiresAt,
          lastValidatedAt: new Date(),
        })
        .where(eq(metaConnections.id, conn.id))

      results.push({
        connectionId: conn.id,
        clientId: conn.clientId,
        success: true,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error"
      console.error(
        `[cron/refresh-tokens] Failed to refresh token for connection ${conn.id}:`,
        message
      )
      results.push({
        connectionId: conn.id,
        clientId: conn.clientId,
        success: false,
        error: message,
      })
    }
  }

  const refreshed = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success).length

  console.log(
    `[cron/refresh-tokens] Processed ${expiring.length} expiring tokens: ${refreshed} refreshed, ${failed} failed`
  )

  return NextResponse.json({
    processed: expiring.length,
    refreshed,
    failed,
    results,
  })
}
