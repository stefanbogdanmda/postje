import { NextResponse } from "next/server"
import { db } from "@/db"
import { checkStalePosts } from "@/lib/alerts/check-stale-posts"
import { sendStalePostEmail } from "@/lib/alerts/stale-post-email"

const CRON_SECRET = process.env.CRON_SECRET
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

export async function GET(req: Request) {
  // Vercel Cron sends: Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.get("authorization")

  if (!CRON_SECRET) {
    console.error("[cron] CRON_SECRET not configured — refusing to run")
    return new NextResponse(null, { status: 500 })
  }

  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    // 401 with empty body — no log spam from scanners hitting random URLs
    return new NextResponse(null, { status: 401 })
  }

  try {
    const result = await checkStalePosts({
      db,
      now: new Date(),
      sendEmail: sendStalePostEmail,
      appUrl: APP_URL,
    })

    return NextResponse.json(result)
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "unknown error"
    console.error(`[cron] check-stale-posts failed: ${message}`)
    return NextResponse.json(
      { error: "internal error" },
      { status: 500 }
    )
  }
}
