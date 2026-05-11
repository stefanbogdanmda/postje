import { describe, it, expect, beforeEach, vi } from "vitest"
import { createTestDb, seedTestClient, type TestDb } from "@/test/db"
import { insertPosts } from "@/lib/posts/repository"
import { posts } from "@/db/schema"
import { eq } from "drizzle-orm"
import { checkStalePosts } from "../check-stale-posts"

const CLIENT_ID = "test-client-001"
const APP_URL = "https://test.example.com"
let db: TestDb

beforeEach(() => {
  db = createTestDb()
  seedTestClient(db, CLIENT_ID)
})

function insertDraftWithFirstSeen(seenAt: Date | null, platform: "instagram" | "facebook" = "instagram") {
  insertPosts(db, [{
    clientId: CLIENT_ID,
    platform,
    scheduledDate: "2026-05-12",
    content: "Test post for alert",
    reasoning: "Test reasoning",
  }])
  const row = db.select().from(posts).where(eq(posts.platform, platform)).get()
  if (seenAt) {
    db.update(posts).set({ firstSeenAt: seenAt }).where(eq(posts.id, row!.id)).run()
  }
  return row!.id
}

describe("checkStalePosts", () => {
  it("returns skipped=true and sends no email when outside business hours", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true })

    // Saturday afternoon — outside business hours
    const now = new Date("2026-01-17T11:00:00Z")

    const result = await checkStalePosts({ db, now, sendEmail, appUrl: APP_URL })

    expect(result.skipped).toBe(true)
    expect(result.alertsSent).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("sends one email per stale post during business hours", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true })
    const seenAt = new Date("2026-01-11T09:00:00Z") // 25h before below "now"

    insertDraftWithFirstSeen(seenAt, "instagram")
    insertDraftWithFirstSeen(seenAt, "facebook")

    // Monday 11:00 CET = 10:00 UTC
    const now = new Date("2026-01-12T10:00:00Z")

    const result = await checkStalePosts({ db, now, sendEmail, appUrl: APP_URL })

    expect(result.skipped).toBe(false)
    expect(result.alertsSent).toBe(2)
    expect(result.alertsFailed).toBe(0)
    expect(sendEmail).toHaveBeenCalledTimes(2)
  })

  it("marks each post as alerted after successful send", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true })
    const seenAt = new Date("2026-01-11T09:00:00Z")
    const postId = insertDraftWithFirstSeen(seenAt)

    const now = new Date("2026-01-12T10:00:00Z")
    await checkStalePosts({ db, now, sendEmail, appUrl: APP_URL })

    const after = db.select().from(posts).where(eq(posts.id, postId)).get()
    expect(after?.alertedAt).toEqual(now)
  })

  it("does NOT mark post as alerted if the email send fails", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: false, error: "boom" })
    const seenAt = new Date("2026-01-11T09:00:00Z")
    const postId = insertDraftWithFirstSeen(seenAt)

    const now = new Date("2026-01-12T10:00:00Z")
    const result = await checkStalePosts({ db, now, sendEmail, appUrl: APP_URL })

    expect(result.alertsSent).toBe(0)
    expect(result.alertsFailed).toBe(1)

    const after = db.select().from(posts).where(eq(posts.id, postId)).get()
    expect(after?.alertedAt).toBeNull()
  })

  it("does not alert posts already alerted (idempotent)", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true })
    const seenAt = new Date("2026-01-11T09:00:00Z")
    const postId = insertDraftWithFirstSeen(seenAt)
    db.update(posts).set({ alertedAt: new Date("2026-01-11T20:00:00Z") })
      .where(eq(posts.id, postId)).run()

    const now = new Date("2026-01-12T10:00:00Z")
    const result = await checkStalePosts({ db, now, sendEmail, appUrl: APP_URL })

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

    const seenAt = new Date("2026-01-11T09:00:00Z")
    insertDraftWithFirstSeen(seenAt, "instagram")
    insertDraftWithFirstSeen(seenAt, "facebook")

    const now = new Date("2026-01-12T10:00:00Z")
    const result = await checkStalePosts({ db, now, sendEmail, appUrl: APP_URL })

    expect(result.alertsSent).toBe(1)
    expect(result.alertsFailed).toBe(1)
  })
})
