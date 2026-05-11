import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import * as schema from "@/db/schema"
import {
  findStalePosts,
  markPostAlerted,
  type StalePost,
} from "@/lib/posts/repository"
import { isWithinNLBusinessHours } from "@/lib/time/business-hours"

type Db = BetterSQLite3Database<typeof schema>

export interface CheckStalePostsResult {
  skipped: boolean
  reason?: string
  alertsSent: number
  alertsFailed: number
}

export interface CheckStalePostsDeps {
  db: Db
  now: Date
  sendEmail: (post: StalePost, appUrl: string) => Promise<{ success: boolean; error?: string }>
  appUrl: string
}

export async function checkStalePosts(
  deps: CheckStalePostsDeps
): Promise<CheckStalePostsResult> {
  const { db, now, sendEmail, appUrl } = deps

  if (!isWithinNLBusinessHours(now)) {
    return {
      skipped: true,
      reason: "outside business hours",
      alertsSent: 0,
      alertsFailed: 0,
    }
  }

  const stale = findStalePosts(db, now)

  let sent = 0
  let failed = 0

  for (const post of stale) {
    const result = await sendEmail(post, appUrl)
    if (result.success) {
      markPostAlerted(db, post.id, now)
      sent++
    } else {
      failed++
      // Log to stderr so it shows up in Vercel runtime logs.
      // Do NOT mark alertedAt — next cron run retries this post.
      console.error(
        `[stale-post-alert] failed to send alert for post ${post.id}: ${result.error ?? "unknown"}`
      )
    }
  }

  return {
    skipped: false,
    alertsSent: sent,
    alertsFailed: failed,
  }
}
