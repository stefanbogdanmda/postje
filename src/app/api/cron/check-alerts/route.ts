import { NextResponse } from "next/server"
import { db } from "@/db"
import { checkStalePosts } from "@/lib/alerts/check-stale-posts"
import { sendStalePostEmail } from "@/lib/alerts/stale-post-email"
import { checkRegenLimits } from "@/lib/alerts/check-regen-limits"
import { sendRegenLimitEmail } from "@/lib/alerts/regen-limit-email"

const CRON_SECRET = process.env.CRON_SECRET
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

interface PassResult {
  skipped: boolean
  reason?: string
  alertsSent: number
  alertsFailed: number
  error?: string
}

async function runPass<T extends PassResult>(
  label: string,
  fn: () => Promise<T>
): Promise<T | PassResult> {
  try {
    return await fn()
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "unknown error"
    console.error(`[cron] ${label} pass failed: ${message}`)
    return {
      skipped: false,
      alertsSent: 0,
      alertsFailed: 0,
      error: message,
    }
  }
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization")

  if (!CRON_SECRET) {
    console.error("[cron] CRON_SECRET not configured — refusing to run")
    return new NextResponse(null, { status: 500 })
  }

  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return new NextResponse(null, { status: 401 })
  }

  const now = new Date()

  const stale = await runPass("stale-posts", () =>
    checkStalePosts({ db, now, sendEmail: sendStalePostEmail, appUrl: APP_URL })
  )

  const regenLimit = await runPass("regen-limit", () =>
    checkRegenLimits({ db, now, sendEmail: sendRegenLimitEmail, appUrl: APP_URL })
  )

  return NextResponse.json({ stale, regenLimit })
}
