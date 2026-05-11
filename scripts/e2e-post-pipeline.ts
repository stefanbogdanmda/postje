/**
 * E2E Post Pipeline Verification
 *
 * Purpose: Exercise the full post generation pipeline end-to-end against a
 * real database and real Claude API. Verifies generation, idempotent
 * regeneration, locked-day preservation, rejection count carry-forward,
 * the GET endpoint, and all-locked early return.
 *
 * Cost:    ~$1 per run (4 real Claude API calls)
 * Runtime: ~60 seconds
 * Requires: dev server running on localhost:3000
 *
 * When to run: Manually before merging changes that touch the generation
 * pipeline, posts table, repository, prompt logic, or related code.
 *
 * Usage: npm run test:e2e
 *    or: npx tsx scripts/e2e-post-pipeline.ts
 */

import crypto from "node:crypto"
import { db } from "../src/db"
import { posts, users, sessions } from "../src/db/schema"
import { eq, and, inArray, sql } from "drizzle-orm"

const BASE_URL = "http://localhost:3000"
const CLIENT_ID = "cafe-de-hoek-00000000"
const START_DATE = "2026-05-12" // a Tuesday
const END_DATE = "2026-05-18" // the following Monday

const SESSION_TOKEN = `e2e-${crypto.randomUUID()}`
const COOKIE_HEADER = `authjs.session-token=${SESSION_TOKEN}`

// ── Helpers ──────────────────────────────────────────────

async function resetPosts() {
  await db.delete(posts).where(eq(posts.clientId, CLIENT_ID))
}

async function createAdminSession() {
  const adminRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(1)
  const admin = adminRows[0]

  if (!admin) {
    console.error("\nERROR: No admin user found. Run `npm run seed:admin` first.")
    process.exit(1)
  }

  const expires = new Date(Date.now() + 60 * 60 * 1000)
  await db.insert(sessions).values({
    sessionToken: SESSION_TOKEN,
    userId: admin.id,
    expires,
  })
}

async function cleanupAdminSession() {
  await db.delete(sessions).where(eq(sessions.sessionToken, SESSION_TOKEN))
}

async function countPosts(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(posts)
    .where(eq(posts.clientId, CLIENT_ID))
  return rows[0]?.count ?? 0
}

async function getPostRows(): Promise<Array<{
  id: string
  clientId: string
  platform: string
  scheduledDate: string
  status: string
  content: string
  rejectionCount: number
}>> {
  const rows = await db
    .select({
      id: posts.id,
      clientId: posts.clientId,
      platform: posts.platform,
      scheduledDate: posts.scheduledDate,
      status: posts.status,
      content: posts.content,
      rejectionCount: posts.rejectionCount,
    })
    .from(posts)
    .where(eq(posts.clientId, CLIENT_ID))
    .orderBy(posts.scheduledDate, posts.platform)
  return rows
}

async function generate(): Promise<{
  status: number
  body: Record<string, unknown>
  durationMs: number
}> {
  const start = Date.now()
  const res = await fetch(`${BASE_URL}/api/generate-posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: COOKIE_HEADER,
    },
    body: JSON.stringify({ clientId: CLIENT_ID, startDate: START_DATE }),
  })
  const durationMs = Date.now() - start
  const body = await res.json()
  return { status: res.status, body, durationMs }
}

let passed = 0
let failed = 0

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  PASS: ${label}`)
    passed++
  } else {
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
    failed++
  }
}

// ── Steps ────────────────────────────────────────────────

async function step3_generateAndAssert14Rows() {
  console.log("\n--- Step 3: Generate posts, assert 14 draft rows ---")

  await resetPosts()
  assert((await countPosts()) === 0, "Posts table empty after reset")

  const { status, body } = await generate()
  assert(status === 200, "POST /api/generate-posts returns 200", `got ${status}`)
  assert(
    typeof body.clientId === "string" &&
      typeof body.startDate === "string" &&
      typeof body.endDate === "string" &&
      typeof body.generatedCount === "number" &&
      typeof body.skippedLockedCount === "number",
    "Response has correct shape (clientId, startDate, endDate, generatedCount, skippedLockedCount)"
  )
  assert(
    (body.generatedCount as number) === 14,
    "generatedCount is 14",
    `got ${body.generatedCount}`
  )
  assert(
    (body.skippedLockedCount as number) === 0,
    "skippedLockedCount is 0",
    `got ${body.skippedLockedCount}`
  )

  const rows = await getPostRows()
  assert(rows.length === 14, `14 rows in DB`, `got ${rows.length}`)
  assert(
    rows.every((r) => r.status === "draft"),
    "All rows have status 'draft'"
  )
  assert(
    rows.every((r) => r.clientId === CLIENT_ID),
    "All rows have correct clientId"
  )
}

async function step4_regenerateIdempotency(): Promise<string[]> {
  console.log("\n--- Step 4: Regenerate, assert idempotency (still 14 rows, different content) ---")

  const oldRows = await getPostRows()
  const oldContents = oldRows.map((r) => r.content)

  const { status } = await generate()
  assert(status === 200, "Second generate returns 200")

  const newRows = await getPostRows()
  assert(newRows.length === 14, `Still 14 rows after regeneration`, `got ${newRows.length}`)

  // At least some content should differ (Claude generates different output)
  const changedCount = newRows.filter(
    (r, i) => r.content !== oldContents[i]
  ).length
  assert(
    changedCount > 0,
    `Content changed for at least some posts`,
    `${changedCount} of 14 posts have different content`
  )

  return newRows.map((r) => r.content)
}

async function step5_getEndpointGrouping() {
  console.log("\n--- Step 5: GET /api/posts, assert grouping by scheduledDate ---")

  const res = await fetch(
    `${BASE_URL}/api/posts?clientId=${CLIENT_ID}&startDate=${START_DATE}&endDate=${END_DATE}`,
    { headers: { Cookie: COOKIE_HEADER } }
  )
  assert(res.status === 200, "GET /api/posts returns 200")

  const data = (await res.json()) as Array<{
    scheduledDate: string
    posts: Array<{ platform: string; content: string }>
  }>

  assert(Array.isArray(data), "Response is an array")
  assert(data.length === 7, `7 date groups returned`, `got ${data.length}`)

  // Each group should have 2 posts (instagram + facebook)
  const allHaveTwo = data.every((g) => g.posts.length === 2)
  assert(allHaveTwo, "Each date group has 2 posts (IG + FB)")

  // Dates should be sorted
  const dates = data.map((g) => g.scheduledDate)
  const sorted = [...dates].sort()
  assert(
    JSON.stringify(dates) === JSON.stringify(sorted),
    "Date groups are sorted chronologically"
  )
}

async function step6_lockedDaySkipped() {
  console.log("\n--- Step 6: Approve first day, regenerate, assert locked day skipped ---")

  // Approve Tuesday's posts
  await db
    .update(posts)
    .set({ status: "approved" })
    .where(
      and(
        eq(posts.clientId, CLIENT_ID),
        eq(posts.scheduledDate, START_DATE)
      )
    )

  const approvedBefore = (await getPostRows()).filter(
    (r) => r.scheduledDate === START_DATE && r.status === "approved"
  )
  assert(approvedBefore.length === 2, "Tuesday has 2 approved rows before generate")
  const approvedIds = approvedBefore.map((r) => r.id)
  const approvedContents = approvedBefore.map((r) => r.content)

  const { status, body } = await generate()
  assert(status === 200, "Generate with locked day returns 200", `got ${status}`)
  assert(
    (body.generatedCount as number) === 12,
    "generatedCount is 12 (6 open days x 2 platforms)",
    `got ${body.generatedCount}`
  )
  assert(
    (body.skippedLockedCount as number) === 1,
    "skippedLockedCount is 1",
    `got ${body.skippedLockedCount}`
  )

  // Approved rows should be untouched
  const approvedAfter = (await getPostRows()).filter(
    (r) => r.scheduledDate === START_DATE && r.status === "approved"
  )
  assert(approvedAfter.length === 2, "Tuesday still has 2 approved rows")
  assert(
    approvedAfter[0].id === approvedIds[0] && approvedAfter[1].id === approvedIds[1],
    "Approved row IDs are unchanged (same rows, not replaced)"
  )
  assert(
    approvedAfter[0].content === approvedContents[0] &&
      approvedAfter[1].content === approvedContents[1],
    "Approved row content is unchanged"
  )

  // Other rows should be drafts
  const otherRows = (await getPostRows()).filter((r) => r.scheduledDate !== START_DATE)
  assert(otherRows.length === 12, `12 non-Tuesday rows`, `got ${otherRows.length}`)
  assert(
    otherRows.every((r) => r.status === "draft"),
    "All non-Tuesday rows are drafts"
  )

  const total = await countPosts()
  assert(total === 14, `Total still 14 (2 approved + 12 draft)`, `got ${total}`)
}

async function step7_rejectionCountCarryForward() {
  console.log("\n--- Step 7: Reject second day with count=2, regenerate, assert carry-forward ---")

  const WEDNESDAY = "2026-05-13"

  // Reject Wednesday's posts with rejectionCount = 2
  await db
    .update(posts)
    .set({ status: "rejected", rejectionCount: 2 })
    .where(
      and(
        eq(posts.clientId, CLIENT_ID),
        eq(posts.scheduledDate, WEDNESDAY),
        eq(posts.status, "draft")
      )
    )

  const rejectedBefore = (await getPostRows()).filter(
    (r) => r.scheduledDate === WEDNESDAY && r.status === "rejected"
  )
  assert(rejectedBefore.length === 2, "Wednesday has 2 rejected rows")
  assert(
    rejectedBefore.every((r) => r.rejectionCount === 2),
    "Rejection counts are 2 before regeneration"
  )

  const { status } = await generate()
  assert(status === 200, "Generate after rejection returns 200", `got ${status}`)

  // Wednesday should now have new draft rows with rejectionCount = 2
  const wednesdayAfter = (await getPostRows()).filter(
    (r) => r.scheduledDate === WEDNESDAY
  )
  assert(wednesdayAfter.length === 2, `Wednesday has 2 rows after regeneration`, `got ${wednesdayAfter.length}`)
  assert(
    wednesdayAfter.every((r) => r.status === "draft"),
    "Wednesday rows are now drafts (replaced)"
  )
  assert(
    wednesdayAfter.every((r) => r.rejectionCount === 2),
    "Rejection counts carried forward (still 2)",
    `got counts: ${wednesdayAfter.map((r) => r.rejectionCount).join(", ")}`
  )
}

async function step8_allLockedEarlyReturn() {
  console.log("\n--- Step 8: Approve all, assert early return (<2s, no Claude call) ---")

  // Approve all remaining draft/rejected rows
  await db
    .update(posts)
    .set({ status: "approved" })
    .where(
      and(
        eq(posts.clientId, CLIENT_ID),
        inArray(posts.status, ["draft", "rejected"])
      )
    )

  const allApproved = (await getPostRows()).filter((r) => r.status === "approved")
  assert(allApproved.length === 14, `All 14 rows are approved`, `got ${allApproved.length}`)

  const contentsBefore = (await getPostRows()).map((r) => r.content)

  const { status, body, durationMs } = await generate()
  assert(status === 200, "All-locked generate returns 200")
  assert(
    (body.generatedCount as number) === 0,
    "generatedCount is 0",
    `got ${body.generatedCount}`
  )
  assert(
    (body.skippedLockedCount as number) === 7,
    "skippedLockedCount is 7",
    `got ${body.skippedLockedCount}`
  )
  assert(
    durationMs < 2000,
    `Response time < 2 seconds (no Claude call)`,
    `took ${durationMs}ms`
  )

  // DB should be unchanged
  const contentsAfter = (await getPostRows()).map((r) => r.content)
  assert(
    JSON.stringify(contentsBefore) === JSON.stringify(contentsAfter),
    "DB content unchanged after all-locked generate"
  )
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  console.log("=== Post Persistence E2E Verification ===")
  console.log(`Server: ${BASE_URL}`)
  console.log(`Client: ${CLIENT_ID}`)
  console.log(`Week: ${START_DATE} to ${END_DATE}`)

  // Check server is reachable
  try {
    await createAdminSession()

    const healthCheck = await fetch(
      `${BASE_URL}/api/posts?clientId=${CLIENT_ID}&startDate=2026-01-01&endDate=2026-01-07`,
      { headers: { Cookie: COOKIE_HEADER } }
    )
    if (!healthCheck.ok) {
      throw new Error(`Server returned ${healthCheck.status}`)
    }
  } catch {
    await cleanupAdminSession()
    console.error("\nERROR: Dev server not reachable at localhost:3000. Start it with `npm run dev` first.")
    process.exit(1)
  }

  await resetPosts()
  console.log("Posts table reset to empty.")

  try {
    await step3_generateAndAssert14Rows()
    await step4_regenerateIdempotency()
    await step5_getEndpointGrouping()
    await step6_lockedDaySkipped()
    await step7_rejectionCountCarryForward()
    await step8_allLockedEarlyReturn()
  } finally {
    // Cleanup
    console.log("\n--- Cleanup ---")
    await resetPosts()
    await cleanupAdminSession()
    console.log("Posts table reset to empty.")
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`)

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
