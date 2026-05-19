import { NextResponse } from "next/server"
import { db } from "@/db"
import { checkStalePosts } from "@/lib/alerts/check-stale-posts"
import { sendStalePostEmail } from "@/lib/alerts/stale-post-email"
import { checkRegenLimits } from "@/lib/alerts/check-regen-limits"
import { sendRegenLimitEmail } from "@/lib/alerts/regen-limit-email"
import { verifyCronSecret } from "@/lib/cron-auth"

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

  const cronAuth = verifyCronSecret(authHeader)
  if (!cronAuth.ok) return cronAuth.response

  const now = new Date()

  const stale = await runPass("stale-posts", () =>
    checkStalePosts({ db, now, sendEmail: sendStalePostEmail, appUrl: APP_URL })
  )

  const regenLimit = await runPass("regen-limit", () =>
    checkRegenLimits({ db, now, sendEmail: sendRegenLimitEmail, appUrl: APP_URL })
  )

  return NextResponse.json({ stale, regenLimit })
}
