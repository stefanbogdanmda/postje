import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/db"
import { clients } from "@/db/schema"
import { eq } from "drizzle-orm"
import { generateOAuthState } from "@/lib/meta/oauth-state"
import { buildAuthUrl } from "@/lib/meta/oauth"

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const url = new URL(req.url)
  const clientId = url.searchParams.get("clientId")
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 })
  }

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
