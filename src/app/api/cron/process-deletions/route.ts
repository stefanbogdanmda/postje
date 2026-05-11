import { NextResponse } from "next/server"
import { del } from "@vercel/blob"
import { db } from "@/db"
import { processDueDeletions } from "@/lib/account/process-deletions"

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(req: Request) {
  if (!CRON_SECRET) {
    console.error("[cron] CRON_SECRET not configured — refusing to run")
    return new NextResponse(null, { status: 500 })
  }

  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return new NextResponse(null, { status: 401 })
  }

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
