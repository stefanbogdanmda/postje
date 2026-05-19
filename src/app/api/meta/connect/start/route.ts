import { z } from "zod"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/db"
import { clients } from "@/db/schema"
import { eq } from "drizzle-orm"
import { generateOAuthState } from "@/lib/meta/oauth-state"
import { buildAuthUrl } from "@/lib/meta/oauth"
import { rateLimitRequest } from "@/lib/request-rate-limit"

const querySchema = z.object({
  clientId: z.string().min(1, "clientId is required"),
})

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const rateLimited = await rateLimitRequest(req, "meta-connect", 5, 60_000)
  if (rateLimited) return rateLimited

  const url = new URL(req.url)
  const params = querySchema.safeParse({ clientId: url.searchParams.get("clientId") })
  if (!params.success) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 })
  }
  const { clientId } = params.data

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
