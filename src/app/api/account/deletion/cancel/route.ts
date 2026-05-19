import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { cancelDeletionRequestByToken } from "@/lib/account/deletion-request"
import { rateLimitRequest } from "@/lib/request-rate-limit"

/**
 * Public endpoint hit by the cancel link in the deletion-confirmation email.
 * Always responds with the same friendly page — never reveals whether a
 * token was valid or not (information-leak prevention).
 */
export async function GET(request: NextRequest) {
  const rateLimited = await rateLimitRequest(request, "deletion-cancel", 10, 60_000)
  if (rateLimited) return rateLimited

  const token = request.nextUrl.searchParams.get("token") ?? ""

  if (token) {
    try {
      await cancelDeletionRequestByToken(db, token, new Date())
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error"
      console.error("[account/deletion/cancel] error", { error: message })
    }
  }

  const url = request.nextUrl.clone()
  url.pathname = "/account/deletion/cancelled"
  url.search = ""
  return NextResponse.redirect(url)
}
