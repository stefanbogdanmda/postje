import { describe, it, expect, beforeEach } from "vitest"
import { createTestDb, seedTestClient, seedTestPhoto, type TestDb } from "@/test/db"
import { users, posts } from "@/db/schema"
import { eq } from "drizzle-orm"
import {
  insertPosts,
  getPostsByDateRange,
  readRejectionCounts,
  replacePostsForOpenDays,
  getLockedDays,
  getPostById,
  approvePost,
  rejectPost,
  regeneratePost,
  markPostsAsSeen,
  findStalePosts,
  markPostAlerted,
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

describe("getPostById", () => {
  it("finds a post by id and clientId", () => {
    insertPosts(db, [makePostRow({ platform: "instagram", scheduledDate: "2026-05-12" })])
    const all = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = getPostById(db, postId, CLIENT_ID)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(postId)
    expect(result!.clientId).toBe(CLIENT_ID)
  })

  it("returns null for wrong clientId", () => {
    insertPosts(db, [makePostRow({ platform: "instagram", scheduledDate: "2026-05-12" })])
    const all = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    seedTestClient(db, "other-client")
    const result = getPostById(db, postId, "other-client")
    expect(result).toBeNull()
  })

  it("returns null for non-existent id", () => {
    const result = getPostById(db, "non-existent-id", CLIENT_ID)
    expect(result).toBeNull()
  })
})

describe("approvePost", () => {
  it("sets status to approved and records approvedAt", () => {
    insertPosts(db, [makePostRow({ platform: "instagram", scheduledDate: "2026-05-12" })])
    const all = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = approvePost(db, postId, CLIENT_ID)
    expect(result.status).toBe("approved")
    expect(result.approvedAt).toBeInstanceOf(Date)
    expect(result.publishAt).toBeInstanceOf(Date)
  })

  it("updates content when provided", () => {
    insertPosts(db, [makePostRow({ content: "Original content" })])
    const all = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = approvePost(db, postId, CLIENT_ID, "Edited content")
    expect(result.content).toBe("Edited content")
    expect(result.status).toBe("approved")
  })

  it("keeps original content when newContent is not provided", () => {
    insertPosts(db, [makePostRow({ content: "Original content" })])
    const all = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = approvePost(db, postId, CLIENT_ID)
    expect(result.content).toBe("Original content")
  })

  it("throws for wrong clientId", () => {
    insertPosts(db, [makePostRow()])
    const all = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    seedTestClient(db, "other-client")
    expect(() => approvePost(db, postId, "other-client")).toThrow("Post not found")
  })

  it("throws when post is not draft", () => {
    insertPosts(db, [makePostRow({ status: "rejected" })])
    const all = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    expect(() => approvePost(db, postId, CLIENT_ID)).toThrow("Cannot approve post")
  })
})

describe("rejectPost", () => {
  it("sets status to rejected and records rejectedAt", () => {
    insertPosts(db, [makePostRow()])
    const all = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = rejectPost(db, postId, CLIENT_ID)
    expect(result.status).toBe("rejected")
    expect(result.rejectedAt).toBeInstanceOf(Date)
  })

  it("increments rejectionCount", () => {
    insertPosts(db, [makePostRow({ rejectionCount: 0 })])
    const all = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = rejectPost(db, postId, CLIENT_ID)
    expect(result.rejectionCount).toBe(1)
  })

  it("throws when post is not draft", () => {
    insertPosts(db, [makePostRow({ status: "approved" })])
    const all = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    expect(() => rejectPost(db, postId, CLIENT_ID)).toThrow("Cannot reject post")
  })

  it("throws for non-existent post", () => {
    expect(() => rejectPost(db, "non-existent", CLIENT_ID)).toThrow("Post not found")
  })
})

describe("regeneratePost", () => {
  it("updates content and reasoning in place", () => {
    insertPosts(db, [makePostRow({ content: "Old content", reasoning: "Old reasoning" })])
    const all = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = regeneratePost(db, postId, CLIENT_ID, "New content", "New reasoning")
    expect(result.content).toBe("New content")
    expect(result.reasoning).toBe("New reasoning")
  })

  it("increments rejectionCount", () => {
    insertPosts(db, [makePostRow({ rejectionCount: 1 })])
    const all = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = regeneratePost(db, postId, CLIENT_ID, "New", "New")
    expect(result.rejectionCount).toBe(2)
  })

  it("keeps the same post id", () => {
    insertPosts(db, [makePostRow()])
    const all = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = regeneratePost(db, postId, CLIENT_ID, "New", "New")
    expect(result.id).toBe(postId)
  })

  it("keeps draft status", () => {
    insertPosts(db, [makePostRow({ status: "draft" })])
    const all = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = regeneratePost(db, postId, CLIENT_ID, "New", "New")
    expect(result.status).toBe("draft")
  })

  it("throws when post is not draft", () => {
    insertPosts(db, [makePostRow({ status: "rejected" })])
    const all = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    expect(() =>
      regeneratePost(db, postId, CLIENT_ID, "New", "New")
    ).toThrow("Cannot regenerate post")
  })

  it("throws for non-existent post", () => {
    expect(() => regeneratePost(db, "non-existent", CLIENT_ID, "New", "New")).toThrow("Post not found")
  })
})

describe("foreign key enforcement", () => {
  it("cascades user deletion to client photos and posts", () => {
    seedTestPhoto(db, CLIENT_ID, "photo-1")
    insertPosts(db, [makePostRow({ photoId: "photo-1" })])

    db.delete(users).where(eq(users.id, `user-${CLIENT_ID}`)).run()

    expect(getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")).toHaveLength(0)
  })
})

describe("markPostsAsSeen", () => {
  it("sets firstSeenAt on posts where it was NULL", () => {
    insertPosts(db, [makePostRow({ platform: "instagram" })])
    const post = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")[0]
    expect(post.firstSeenAt).toBeNull()

    const now = new Date("2026-05-12T10:00:00Z")
    markPostsAsSeen(db, [post.id], CLIENT_ID, now)

    const updated = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")[0]
    expect(updated.firstSeenAt).toEqual(now)
  })

  it("does NOT overwrite an existing firstSeenAt value", () => {
    insertPosts(db, [makePostRow({ platform: "instagram" })])
    const post = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")[0]

    const original = new Date("2026-05-12T10:00:00Z")
    markPostsAsSeen(db, [post.id], CLIENT_ID, original)

    const later = new Date("2026-05-13T10:00:00Z")
    markPostsAsSeen(db, [post.id], CLIENT_ID, later)

    const updated = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")[0]
    expect(updated.firstSeenAt).toEqual(original)
  })

  it("only affects posts owned by the given client (tenant isolation)", () => {
    const OTHER_CLIENT = "other-client-002"
    seedTestClient(db, OTHER_CLIENT)

    insertPosts(db, [makePostRow({ platform: "instagram" })])
    db.insert(posts).values({
      clientId: OTHER_CLIENT,
      platform: "instagram",
      scheduledDate: "2026-05-12",
      status: "draft",
      content: "Other client post",
      reasoning: "x",
    }).run()

    const ourPost = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")[0]
    const otherPost = getPostsByDateRange(db, OTHER_CLIENT, "2026-05-12", "2026-05-12")[0]

    const now = new Date("2026-05-12T10:00:00Z")
    markPostsAsSeen(db, [ourPost.id, otherPost.id], CLIENT_ID, now)

    const ourAfter = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")[0]
    const otherAfter = getPostsByDateRange(db, OTHER_CLIENT, "2026-05-12", "2026-05-12")[0]

    expect(ourAfter.firstSeenAt).toEqual(now)
    expect(otherAfter.firstSeenAt).toBeNull() // not ours, not stamped
  })

  it("is a no-op with an empty postIds array", () => {
    insertPosts(db, [makePostRow({ platform: "instagram" })])
    const now = new Date("2026-05-12T10:00:00Z")
    expect(() => markPostsAsSeen(db, [], CLIENT_ID, now)).not.toThrow()

    const post = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")[0]
    expect(post.firstSeenAt).toBeNull()
  })
})

describe("findStalePosts", () => {
  // Helper to insert a post and immediately patch firstSeenAt/alertedAt/status
  // via direct UPDATE, since insertPosts doesn't expose those columns.
  function insertWithState(opts: {
    scheduledDate?: string
    platform?: Platform
    status: PostStatus
    firstSeenAt: Date | null
    alertedAt: Date | null
  }) {
    insertPosts(db, [
      makePostRow({
        scheduledDate: opts.scheduledDate ?? "2026-05-12",
        platform: opts.platform ?? "instagram",
      }),
    ])
    const post = getPostsByDateRange(
      db,
      CLIENT_ID,
      opts.scheduledDate ?? "2026-05-12",
      opts.scheduledDate ?? "2026-05-12"
    ).find((p) => p.platform === (opts.platform ?? "instagram"))!

    db.update(posts)
      .set({
        status: opts.status,
        firstSeenAt: opts.firstSeenAt,
        alertedAt: opts.alertedAt,
      })
      .where(eq(posts.id, post.id))
      .run()

    return post.id
  }

  it("returns a draft post seen >24h ago with no alert", () => {
    const cutoff = new Date("2026-05-13T10:00:00Z")
    const seenAt = new Date("2026-05-12T09:00:00Z") // 25 hours earlier

    insertWithState({
      status: "draft",
      firstSeenAt: seenAt,
      alertedAt: null,
    })

    const stale = findStalePosts(db, cutoff)
    expect(stale).toHaveLength(1)
  })

  it("excludes posts that are NOT draft", () => {
    const cutoff = new Date("2026-05-13T10:00:00Z")
    const seenAt = new Date("2026-05-12T09:00:00Z")

    insertWithState({ status: "approved", firstSeenAt: seenAt, alertedAt: null, platform: "instagram" })
    insertWithState({ status: "rejected", firstSeenAt: seenAt, alertedAt: null, platform: "facebook" })
    insertWithState({ status: "published", firstSeenAt: seenAt, alertedAt: null, scheduledDate: "2026-05-13" })

    expect(findStalePosts(db, cutoff)).toHaveLength(0)
  })

  it("excludes posts where firstSeenAt is NULL", () => {
    const cutoff = new Date("2026-05-13T10:00:00Z")

    insertWithState({ status: "draft", firstSeenAt: null, alertedAt: null })

    expect(findStalePosts(db, cutoff)).toHaveLength(0)
  })

  it("excludes posts seen less than 24h ago", () => {
    const cutoff = new Date("2026-05-13T10:00:00Z")
    const seenAt = new Date("2026-05-12T15:00:00Z") // 19 hours earlier

    insertWithState({ status: "draft", firstSeenAt: seenAt, alertedAt: null })

    expect(findStalePosts(db, cutoff)).toHaveLength(0)
  })

  it("excludes posts that have already been alerted", () => {
    const cutoff = new Date("2026-05-13T10:00:00Z")
    const seenAt = new Date("2026-05-12T09:00:00Z")
    const alertedAt = new Date("2026-05-12T20:00:00Z")

    insertWithState({ status: "draft", firstSeenAt: seenAt, alertedAt })

    expect(findStalePosts(db, cutoff)).toHaveLength(0)
  })

  it("returns multiple matching posts", () => {
    const cutoff = new Date("2026-05-13T10:00:00Z")
    const seenAt = new Date("2026-05-12T09:00:00Z")

    insertWithState({ status: "draft", firstSeenAt: seenAt, alertedAt: null, platform: "instagram" })
    insertWithState({ status: "draft", firstSeenAt: seenAt, alertedAt: null, platform: "facebook" })

    expect(findStalePosts(db, cutoff)).toHaveLength(2)
  })

  it("includes client businessName in each result row", () => {
    const cutoff = new Date("2026-05-13T10:00:00Z")
    const seenAt = new Date("2026-05-12T09:00:00Z")

    insertWithState({ status: "draft", firstSeenAt: seenAt, alertedAt: null })

    const stale = findStalePosts(db, cutoff)
    expect(stale[0].businessName).toBe("Test Café")
    expect(stale[0].clientId).toBe(CLIENT_ID)
  })
})

describe("markPostAlerted", () => {
  it("sets alertedAt on the matching post", () => {
    insertPosts(db, [makePostRow({ platform: "instagram" })])
    const post = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")[0]

    const now = new Date("2026-05-13T10:00:00Z")
    markPostAlerted(db, post.id, now)

    const after = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")[0]
    expect(after.alertedAt).toEqual(now)
  })

  it("does NOT overwrite an existing alertedAt", () => {
    insertPosts(db, [makePostRow({ platform: "instagram" })])
    const post = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")[0]

    const first = new Date("2026-05-13T10:00:00Z")
    markPostAlerted(db, post.id, first)

    const second = new Date("2026-05-14T10:00:00Z")
    markPostAlerted(db, post.id, second)

    const after = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")[0]
    expect(after.alertedAt).toEqual(first)
  })
})
