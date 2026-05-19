import { NextResponse } from "next/server"
import { del } from "@vercel/blob"
import { db } from "@/db"
import { processDueDeletions } from "@/lib/account/process-deletions"
import { verifyCronSecret } from "@/lib/cron-auth"

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization")

  const cronAuth = verifyCronSecret(authHeader)
  if (!cronAuth.ok) return cronAuth.response

  try {
    const result = await processDueDeletions(
      db,
      { deleteBlob: async (url) => { await del(url) } },
      new Date()
    )
    return NextResponse.json(result)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error"
    console.error(`[cron] process-deletions failed: ${message}`)
    return NextResponse.json(
      { processed: 0, failed: 0, error: message },
      { status: 500 }
    )
  }
}
