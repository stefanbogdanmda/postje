import { describe, it, expect, beforeEach, vi } from "vitest"
import { createTestDb, seedTestClient, type TestDb } from "@/test/db"
import { insertPosts } from "@/lib/posts/repository"
import { posts } from "@/db/schema"
import { eq } from "drizzle-orm"
import { checkRegenLimits } from "../check-regen-limits"

const CLIENT_ID = "test-client-001"
const APP_URL = "https://test.example.com"
let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
  await seedTestClient(db, CLIENT_ID)
})

async function insertDraftAtRegenLimit(
  platform: "instagram" | "facebook" = "instagram",
  rejectionCount = 3
) {
  await insertPosts(db, [{
    clientId: CLIENT_ID,
    platform,
    scheduledDate: "2026-05-12",
    content: "Test post content",
    reasoning: "Test reasoning",
  }])
  const rows = await db.select().from(posts).where(eq(posts.platform, platform)).limit(1)
  const row = rows[0]
  await db.update(posts).set({ rejectionCount }).where(eq(posts.id, row!.id))
  return row!.id
}

describe("checkRegenLimits", () => {
  it("returns skipped=true and sends no email when outside business hours", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true })

    // Saturday — outside business hours
    const now = new Date("2026-01-17T11:00:00Z")

    const result = await checkRegenLimits({ db, now, sendEmail, appUrl: APP_URL })

    expect(result.skipped).toBe(true)
    expect(result.alertsSent).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("returns alertsSent=0 and calls no email when no posts match during business hours", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true })

    // Monday 11:00 CET = 10:00 UTC — inside business hours, but no posts inserted
    const now = new Date("2026-01-12T10:00:00Z")

    const result = await checkRegenLimits({ db, now, sendEmail, appUrl: APP_URL })

    expect(result.skipped).toBe(false)
    expect(result.alertsSent).toBe(0)
    expect(result.alertsFailed).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("sends one email per regen-limit post during business hours", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true })

    await insertDraftAtRegenLimit("instagram")
    await insertDraftAtRegenLimit("facebook")

    // Monday 11:00 CET = 10:00 UTC
    const now = new Date("2026-01-12T10:00:00Z")

    const result = await checkRegenLimits({ db, now, sendEmail, appUrl: APP_URL })

    expect(result.skipped).toBe(false)
    expect(result.alertsSent).toBe(2)
    expect(result.alertsFailed).toBe(0)
    expect(sendEmail).toHaveBeenCalledTimes(2)
  })

  it("marks each post as alerted after successful send", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true })
    const postId = await insertDraftAtRegenLimit("instagram")

    const now = new Date("2026-01-12T10:00:00Z")
    await checkRegenLimits({ db, now, sendEmail, appUrl: APP_URL })

    const afterRows = await db.select().from(posts).where(eq(posts.id, postId)).limit(1)
    expect(afterRows[0]?.regenLimitAlertedAt).toEqual(now)
  })

  it("does NOT mark post as alerted if the email send fails", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: false, error: "boom" })
    const postId = await insertDraftAtRegenLimit("instagram")

    const now = new Date("2026-01-12T10:00:00Z")
    const result = await checkRegenLimits({ db, now, sendEmail, appUrl: APP_URL })

    expect(result.alertsSent).toBe(0)
    expect(result.alertsFailed).toBe(1)

    const afterRows = await db.select().from(posts).where(eq(posts.id, postId)).limit(1)
    expect(afterRows[0]?.regenLimitAlertedAt).toBeNull()
  })

  it("does not alert posts already alerted (idempotent)", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true })
    const postId = await insertDraftAtRegenLimit("instagram")
    await db.update(posts).set({ regenLimitAlertedAt: new Date("2026-01-11T20:00:00Z") })
      .where(eq(posts.id, postId))

    const now = new Date("2026-01-12T10:00:00Z")
    const result = await checkRegenLimits({ db, now, sendEmail, appUrl: APP_URL })

    expect(result.alertsSent).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("continues processing remaining posts if one email fails", async () => {
    let callCount = 0
    const sendEmail = vi.fn(async () => {
      callCount++
      return callCount === 1
        ? { success: false, error: "boom" }
        : { success: true }
    })

    await insertDraftAtRegenLimit("instagram")
    await insertDraftAtRegenLimit("facebook")

    const now = new Date("2026-01-12T10:00:00Z")
    const result = await checkRegenLimits({ db, now, sendEmail, appUrl: APP_URL })

    expect(result.alertsSent).toBe(1)
    expect(result.alertsFailed).toBe(1)
  })
})
