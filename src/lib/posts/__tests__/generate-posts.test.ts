import { describe, it, expect, beforeEach } from "vitest"
import { createTestDb, seedTestClient, seedTestPhoto, type TestDb } from "@/test/db"
import {
  insertPosts,
  getPostsByDateRange,
  readRejectionCounts,
  replacePostsForOpenDays,
  getLockedDays,
} from "../repository"
import { buildLockedDaysContext } from "../locked-days"
import { dayNameToDate, getDateRange } from "../dates"
import type { Platform } from "../config"

/**
 * This test simulates the generation route's orchestration logic
 * without touching the Anthropic API or Next.js route handler.
 * It uses the same functions the route calls, in the same order.
 */

let db: TestDb
const CLIENT_ID = "test-client-001"
const START_DATE = "2026-05-12" // a Tuesday

function makePostRow(overrides: Partial<{
  platform: Platform
  scheduledDate: string
  status: "draft" | "approved" | "rejected" | "published" | "failed"
  content: string
  reasoning: string
  photoId: string | null
  rejectionCount: number
}> = {}) {
  return {
    clientId: CLIENT_ID,
    platform: (overrides.platform ?? "instagram") as Platform,
    scheduledDate: overrides.scheduledDate ?? "2026-05-12",
    status: overrides.status ?? "draft",
    content: overrides.content ?? "Test content",
    reasoning: overrides.reasoning ?? "Test reasoning",
    photoId: overrides.photoId ?? null,
    rejectionCount: overrides.rejectionCount ?? 0,
  }
}

/** Simulate Claude returning posts for given day names. */
function mockClaudeOutput(dayNames: string[]) {
  return dayNames.map((day) => ({
    day,
    instagramCaption: `IG post for ${day}`,
    facebookPost: `FB post for ${day}`,
    reasoning: `Reasoning for ${day}`,
  }))
}

beforeEach(async () => {
  db = await createTestDb()
  await seedTestClient(db, CLIENT_ID)
})

describe("generation orchestration", () => {
  it("detects locked days and skips them during generation", () => {
    // Monday approved (locked), rest are open
    const tuesdayDate = dayNameToDate("Tuesday", START_DATE)
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: tuesdayDate, status: "approved" }),
      makePostRow({ platform: "facebook", scheduledDate: tuesdayDate, status: "approved" }),
    ])

    const dateRange = getDateRange(START_DATE)
    const endDate = dateRange[dateRange.length - 1]
    const lockedDays = getLockedDays(db, CLIENT_ID, START_DATE, endDate)
    const lockedDates = new Set(lockedDays.map((d) => d.scheduledDate))
    const openDates = dateRange.filter((d) => !lockedDates.has(d))

    expect(lockedDays).toHaveLength(1)
    expect(lockedDays[0].scheduledDate).toBe(tuesdayDate)
    expect(openDates).toHaveLength(6)
    expect(openDates).not.toContain(tuesdayDate)
  })

  it("includes locked-day context in plan prompt", async () => {
    const tuesdayDate = dayNameToDate("Tuesday", START_DATE)

    // Seed the photo row first to satisfy the FK constraint
    await seedTestPhoto(db, CLIENT_ID, "photo-1")

    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: tuesdayDate, status: "approved", photoId: "photo-1" }),
      makePostRow({ platform: "facebook", scheduledDate: tuesdayDate, status: "approved", photoId: "photo-1" }),
    ])

    const dateRange = getDateRange(START_DATE)
    const endDate = dateRange[dateRange.length - 1]
    const lockedDays = getLockedDays(db, CLIENT_ID, START_DATE, endDate)
    const lockedDates = new Set(lockedDays.map((d) => d.scheduledDate))
    const openDates = dateRange.filter((d) => !lockedDates.has(d))

    const context = buildLockedDaysContext(lockedDays, openDates)

    expect(context).toContain("LOCKED:")
    expect(context).toContain(`${tuesdayDate}: photo assigned`)
    expect(context).toContain("OPEN (plan these):")
  })

  it("carries rejection counts forward through regeneration", () => {
    const tuesdayDate = dayNameToDate("Tuesday", START_DATE)

    // Insert rejected posts with count=2
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: tuesdayDate, status: "rejected", rejectionCount: 2 }),
      makePostRow({ platform: "facebook", scheduledDate: tuesdayDate, status: "rejected", rejectionCount: 2 }),
    ])

    // Read counts BEFORE Claude call (read-only)
    const counts = readRejectionCounts(db, CLIENT_ID, [tuesdayDate])
    expect(counts.get(`${tuesdayDate}:instagram`)).toBe(2)
    expect(counts.get(`${tuesdayDate}:facebook`)).toBe(2)

    // Simulate Claude output
    const claudeOutput = mockClaudeOutput(["Tuesday"])

    // Build replacement rows with inherited counts
    const newRows = claudeOutput.flatMap((post) => {
      const scheduledDate = dayNameToDate(post.day, START_DATE)
      return (["instagram", "facebook"] as Platform[]).map((platform) => ({
        clientId: CLIENT_ID,
        platform,
        scheduledDate,
        content: platform === "instagram" ? post.instagramCaption : post.facebookPost,
        reasoning: post.reasoning,
        photoId: null,
        rejectionCount: counts.get(`${scheduledDate}:${platform}`) ?? 0,
      }))
    })

    // Atomic replace
    replacePostsForOpenDays(db, CLIENT_ID, [tuesdayDate], newRows)

    // Verify counts carried forward
    const result = getPostsByDateRange(db, CLIENT_ID, tuesdayDate, tuesdayDate)
    expect(result).toHaveLength(2)
    expect(result[0].rejectionCount).toBe(2)
    expect(result[1].rejectionCount).toBe(2)
    expect(result[0].status).toBe("draft")
  })

  it("persists posts with correct scheduledDates from day names", () => {
    const claudeOutput = mockClaudeOutput(["Tuesday", "Wednesday", "Thursday"])

    const newRows = claudeOutput.flatMap((post) => {
      const scheduledDate = dayNameToDate(post.day, START_DATE)
      return (["instagram", "facebook"] as Platform[]).map((platform) => ({
        clientId: CLIENT_ID,
        platform,
        scheduledDate,
        content: platform === "instagram" ? post.instagramCaption : post.facebookPost,
        reasoning: post.reasoning,
        photoId: null,
        rejectionCount: 0,
      }))
    })

    replacePostsForOpenDays(db, CLIENT_ID, getDateRange(START_DATE), newRows)

    const result = getPostsByDateRange(db, CLIENT_ID, START_DATE, dayNameToDate("Monday", START_DATE))
    expect(result).toHaveLength(6) // 3 days x 2 platforms

    const tuesdayPosts = result.filter((p) => p.scheduledDate === "2026-05-12")
    expect(tuesdayPosts).toHaveLength(2)
    expect(tuesdayPosts.find((p) => p.platform === "instagram")?.content).toBe("IG post for Tuesday")

    const wednesdayPosts = result.filter((p) => p.scheduledDate === "2026-05-13")
    expect(wednesdayPosts).toHaveLength(2)
  })

  it("returns early when all days are locked (no Claude call needed)", () => {
    const dateRange = getDateRange(START_DATE)

    // Approve all 7 days
    const allRows = dateRange.flatMap((date) => [
      makePostRow({ platform: "instagram", scheduledDate: date, status: "approved" }),
      makePostRow({ platform: "facebook", scheduledDate: date, status: "approved" }),
    ])
    insertPosts(db, allRows)

    const endDate = dateRange[dateRange.length - 1]
    const lockedDays = getLockedDays(db, CLIENT_ID, START_DATE, endDate)
    const lockedDates = new Set(lockedDays.map((d) => d.scheduledDate))
    const openDates = dateRange.filter((d) => !lockedDates.has(d))

    expect(openDates).toHaveLength(0)
    // Route would return early here — no Claude call made
  })
})
