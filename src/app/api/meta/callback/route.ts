import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/db"
import { verifyOAuthState } from "@/lib/meta/oauth-state"
import * as oauthModule from "@/lib/meta/oauth"
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
    const shortLived = await oauthModule.exchangeCodeForToken(code)
    const longLived = await oauthModule.extendUserToken(shortLived.accessToken)
    const pages = await oauthModule.fetchUserPages(longLived.accessToken)

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
