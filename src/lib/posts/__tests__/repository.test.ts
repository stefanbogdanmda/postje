import { describe, it, expect, beforeEach } from "vitest"
import { createTestDb, seedTestClient, seedTestPhoto, type TestDb } from "@/test/db"
import {
  insertPosts,
  getPostsByDateRange,
  readRejectionCounts,
  replacePostsForOpenDays,
  getLockedDays,
} from "../repository"
import type { Platform, PostStatus } from "../config"

let db: TestDb
const CLIENT_ID = "test-client-001"

function makePostRow(overrides: Partial<{
  platform: Platform
  scheduledDate: string
  status: PostStatus
  content: string
  reasoning: string
  photoId: string | null
  rejectionCount: number
}> = {}) {
  return {
    clientId: CLIENT_ID,
    platform: (overrides.platform ?? "instagram") as Platform,
    scheduledDate: overrides.scheduledDate ?? "2026-05-12",
    status: (overrides.status ?? "draft") as PostStatus,
    content: overrides.content ?? "Test post content",
    reasoning: overrides.reasoning ?? "Test reasoning",
    photoId: overrides.photoId ?? null,
    rejectionCount: overrides.rejectionCount ?? 0,
  }
}

beforeEach(() => {
  db = createTestDb()
  seedTestClient(db, CLIENT_ID)
})

describe("insertPosts", () => {
  it("inserts rows into the posts table", () => {
    const rows = [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12" }),
    ]

    insertPosts(db, rows)

    const result = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(result).toHaveLength(2)
    expect(result[0].status).toBe("draft")
    expect(result[0].clientId).toBe(CLIENT_ID)
  })

  it("inherits rejection count", () => {
    const rows = [
      makePostRow({ platform: "instagram", rejectionCount: 2 }),
    ]

    insertPosts(db, rows)

    const result = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(result[0].rejectionCount).toBe(2)
  })
})

describe("getPostsByDateRange", () => {
  it("returns posts within the date range", () => {
    insertPosts(db, [
      makePostRow({ scheduledDate: "2026-05-12" }),
      makePostRow({ scheduledDate: "2026-05-14" }),
      makePostRow({ scheduledDate: "2026-05-20" }),
    ])

    const result = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(result).toHaveLength(2)
  })

  it("filters by client ID", () => {
    seedTestClient(db, "other-client")
    insertPosts(db, [
      makePostRow({ scheduledDate: "2026-05-12" }),
      { ...makePostRow({ scheduledDate: "2026-05-12" }), clientId: "other-client" },
    ])

    const result = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(result).toHaveLength(1)
    expect(result[0].clientId).toBe(CLIENT_ID)
  })

  it("returns empty array when no posts exist", () => {
    const result = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(result).toHaveLength(0)
  })
})

describe("readRejectionCounts", () => {
  it("returns empty map when no rejected posts exist", () => {
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "draft" }),
    ])

    const counts = readRejectionCounts(db, CLIENT_ID, ["2026-05-12"])
    expect(counts.size).toBe(0)
  })

  it("returns rejection counts from rejected posts without deleting them", () => {
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "rejected", rejectionCount: 2 }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", status: "rejected", rejectionCount: 2 }),
    ])

    const counts = readRejectionCounts(db, CLIENT_ID, ["2026-05-12"])
    expect(counts.get("2026-05-12:instagram")).toBe(2)
    expect(counts.get("2026-05-12:facebook")).toBe(2)

    // Posts still exist (read-only operation)
    const remaining = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(remaining).toHaveLength(2)
  })
})

describe("replacePostsForOpenDays", () => {
  it("deletes drafts and inserts new rows in one transaction", () => {
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "draft" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", status: "draft" }),
    ])

    const newRows = [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", content: "New IG" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", content: "New FB" }),
    ]

    replacePostsForOpenDays(db, CLIENT_ID, ["2026-05-12"], newRows)

    const result = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(result).toHaveLength(2)
    expect(result.find((p) => p.platform === "instagram")?.content).toBe("New IG")
    expect(result.find((p) => p.platform === "facebook")?.content).toBe("New FB")
  })

  it("deletes rejected posts and inserts replacements", () => {
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "rejected", rejectionCount: 1 }),
    ])

    const newRows = [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", content: "Replacement", rejectionCount: 1 }),
    ]

    replacePostsForOpenDays(db, CLIENT_ID, ["2026-05-12"], newRows)

    const result = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe("Replacement")
    expect(result[0].rejectionCount).toBe(1)
  })

  it("does NOT delete approved posts", () => {
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "approved" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", status: "approved" }),
    ])

    replacePostsForOpenDays(db, CLIENT_ID, ["2026-05-12"], [])

    const remaining = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(remaining).toHaveLength(2)
  })

  it("does NOT delete published or failed posts", () => {
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "published" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", status: "failed" }),
    ])

    replacePostsForOpenDays(db, CLIENT_ID, ["2026-05-12"], [])

    const remaining = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(remaining).toHaveLength(2)
  })
})

describe("getLockedDays", () => {
  it("returns days with approved posts", () => {
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "approved" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", status: "approved" }),
    ])

    const locked = getLockedDays(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(locked).toHaveLength(1)
    expect(locked[0].scheduledDate).toBe("2026-05-12")
  })

  it("reports hasPhoto correctly", () => {
    seedTestPhoto(db, CLIENT_ID, "photo-1")
    insertPosts(db, [
      makePostRow({ scheduledDate: "2026-05-12", status: "approved", photoId: "photo-1" }),
      makePostRow({ scheduledDate: "2026-05-13", status: "published", photoId: null }),
    ])

    const locked = getLockedDays(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(locked).toHaveLength(2)

    const withPhoto = locked.find((d) => d.scheduledDate === "2026-05-12")
    const withoutPhoto = locked.find((d) => d.scheduledDate === "2026-05-13")
    expect(withPhoto?.hasPhoto).toBe(true)
    expect(withoutPhoto?.hasPhoto).toBe(false)
  })

  it("does NOT include draft or rejected days", () => {
    insertPosts(db, [
      makePostRow({ scheduledDate: "2026-05-12", status: "draft" }),
      makePostRow({ scheduledDate: "2026-05-13", status: "rejected" }),
    ])

    const locked = getLockedDays(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(locked).toHaveLength(0)
  })
})
