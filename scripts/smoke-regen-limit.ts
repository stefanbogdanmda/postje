/**
 * Task 7 smoke test for regen-limit alerts.
 *
 * Run with: npx tsx --env-file=.env.local scripts/smoke-regen-limit.ts
 *
 * What it does:
 *   1. Reports DB state (existing draft posts, env-var presence)
 *   2. Picks a draft post, saves its original state
 *   3. UPDATEs rejectionCount=3 + regenLimitAlertedAt=NULL
 *   4. Calls checkRegenLimits DIRECTLY with a mocked business-hours `now`,
 *      using the real sendRegenLimitEmail (which calls Resend)
 *   5. Verifies result + DB stamp
 *   6. Calls again, verifies idempotency (alertsSent=0)
 *   7. Resets the post to its original state
 *
 * The mocked `now` is required because actual time is currently outside
 * NL business hours; the unit tests already cover the clock gate.
 *
 * This script does NOT spin up the dev server — it imports the core logic
 * directly. HTTP layer is verified separately by the run-http-smoke.ts script.
 */

import { eq } from "drizzle-orm"
import { db } from "../src/db"
import { posts } from "../src/db/schema"
import { checkRegenLimits } from "../src/lib/alerts/check-regen-limits"
import { sendRegenLimitEmail } from "../src/lib/alerts/regen-limit-email"

function fail(msg: string): never {
  console.error(`\n❌ ${msg}`)
  process.exit(1)
}

function ok(msg: string): void {
  console.log(`✅ ${msg}`)
}

function info(msg: string): void {
  console.log(`   ${msg}`)
}

async function main() {
  // Env check
  const hasResend = !!process.env.AUTH_RESEND_KEY
  const hasAdmin = !!process.env.ADMIN_EMAIL
  console.log(`\n— env: AUTH_RESEND_KEY=${hasResend ? "set" : "MISSING"} ADMIN_EMAIL=${hasAdmin ? "set" : "MISSING"}`)
  if (!hasResend) fail("AUTH_RESEND_KEY not loaded — make sure you ran with --env-file=.env.local")
  if (!hasAdmin) fail("ADMIN_EMAIL not loaded — make sure you ran with --env-file=.env.local")

  // Pick a draft post
  const draftPosts = await db
    .select()
    .from(posts)
    .where(eq(posts.status, "draft"))

  console.log(`\n— found ${draftPosts.length} draft posts in DB`)
  if (draftPosts.length === 0) {
    fail(
      "No draft posts found in the DB. Create at least one via /admin/clients/[id]/generate-posts in the dev app before running this smoke test."
    )
  }

  const target = draftPosts[0]
  info(`using post id: ${target.id}`)
  info(`  scheduledDate: ${target.scheduledDate}`)
  info(`  platform: ${target.platform}`)
  info(`  current rejectionCount: ${target.rejectionCount}`)
  info(`  current regenLimitAlertedAt: ${target.regenLimitAlertedAt ?? "null"}`)

  // Save original state for cleanup
  const originalRejectionCount = target.rejectionCount
  const originalRegenLimitAlertedAt = target.regenLimitAlertedAt

  try {
    // ── Setup ─────────────────────────────────────────────────────
    console.log("\n— setup: rejectionCount=3, regenLimitAlertedAt=NULL")
    await db.update(posts)
      .set({ rejectionCount: 3, regenLimitAlertedAt: null })
      .where(eq(posts.id, target.id))
    ok("post primed at regen limit")

    // Use a mock `now` that falls within NL business hours
    // Monday 2026-05-11 at 11:00 NL (UTC+2 in May) = 09:00 UTC
    const businessHoursNow = new Date("2026-05-11T09:30:00Z")

    // ── Pass 1: should send + stamp ──────────────────────────────
    console.log("\n— pass 1: calling checkRegenLimits (mock now: Mon 11:30 NL)")
    const result1 = await checkRegenLimits({
      db,
      now: businessHoursNow,
      sendEmail: sendRegenLimitEmail,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    })

    console.log(`   result: ${JSON.stringify(result1)}`)
    if (result1.skipped) fail(`expected skipped=false but got skipped=true (${result1.reason})`)
    if (result1.alertsSent !== 1) fail(`expected alertsSent=1 but got ${result1.alertsSent}`)
    if (result1.alertsFailed !== 0) fail(`expected alertsFailed=0 but got ${result1.alertsFailed} — Resend probably rejected the send. Check console.error above.`)
    ok("alertsSent=1, alertsFailed=0")

    // Verify DB stamp
    const afterRows = await db.select().from(posts).where(eq(posts.id, target.id)).limit(1)
    const afterFirst = afterRows[0]
    if (!afterFirst?.regenLimitAlertedAt) fail("regenLimitAlertedAt was not stamped on success")
    ok(`regenLimitAlertedAt stamped: ${afterFirst.regenLimitAlertedAt.toISOString()}`)

    // ── Pass 2: should be idempotent ─────────────────────────────
    console.log("\n— pass 2: calling checkRegenLimits again (idempotency check)")
    const result2 = await checkRegenLimits({
      db,
      now: businessHoursNow,
      sendEmail: sendRegenLimitEmail,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    })

    console.log(`   result: ${JSON.stringify(result2)}`)
    if (result2.alertsSent !== 0) fail(`expected alertsSent=0 (idempotent) but got ${result2.alertsSent} — would send a duplicate email!`)
    if (result2.alertsFailed !== 0) fail(`expected alertsFailed=0 but got ${result2.alertsFailed}`)
    ok("alertsSent=0 — idempotency holds, no duplicate email")

    // ── Done ─────────────────────────────────────────────────────
    console.log("\n✅ all DB + alert-logic checks passed")
    console.log("   → check the inbox for ADMIN_EMAIL: exactly ONE email should have arrived")
    console.log("   → subject should contain 'Klant heeft een post 3× laten herschrijven'")
  } finally {
    // ── Cleanup ──────────────────────────────────────────────────
    console.log("\n— cleanup: restoring original post state")
    await db.update(posts)
      .set({
        rejectionCount: originalRejectionCount,
        regenLimitAlertedAt: originalRegenLimitAlertedAt,
      })
      .where(eq(posts.id, target.id))
    ok(`post ${target.id} restored to rejectionCount=${originalRejectionCount}, regenLimitAlertedAt=${originalRegenLimitAlertedAt ?? "null"}`)
  }
}

main().catch((err) => {
  console.error("\n❌ smoke test threw:", err)
  process.exit(1)
})
