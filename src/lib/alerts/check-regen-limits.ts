import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import * as schema from "@/db/schema"
import {
  findPostsAtRegenLimit,
  markPostRegenLimitAlerted,
  type RegenLimitPost,
} from "@/lib/posts/repository"
import { isWithinNLBusinessHours } from "@/lib/time/business-hours"

type Db = BetterSQLite3Database<typeof schema>

export interface CheckRegenLimitsResult {
  skipped: boolean
  reason?: string
  alertsSent: number
  alertsFailed: number
}

export interface CheckRegenLimitsDeps {
  db: Db
  now: Date
  sendEmail: (
    post: RegenLimitPost,
    appUrl: string
  ) => Promise<{ success: boolean; error?: string }>
  appUrl: string
}

export async function checkRegenLimits(
  deps: CheckRegenLimitsDeps
): Promise<CheckRegenLimitsResult> {
  const { db, now, sendEmail, appUrl } = deps

  if (!isWithinNLBusinessHours(now)) {
    return {
      skipped: true,
      reason: "outside business hours",
      alertsSent: 0,
      alertsFailed: 0,
    }
  }

  const matches = findPostsAtRegenLimit(db)

  let sent = 0
  let failed = 0

  for (const post of matches) {
    const result = await sendEmail(post, appUrl)
    if (result.success) {
      markPostRegenLimitAlerted(db, post.id, now)
      sent++
    } else {
      failed++
      // Log to stderr so it shows up in Vercel runtime logs.
      // Do NOT stamp regenLimitAlertedAt — next cron run retries this post.
      console.error(
        `[regen-limit-alert] failed to send alert for post ${post.id}: ${result.error ?? "unknown"}`
      )
    }
  }

  return {
    skipped: false,
    alertsSent: sent,
    alertsFailed: failed,
  }
}
