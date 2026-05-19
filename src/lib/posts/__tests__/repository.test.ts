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
  findPostsAtRegenLimit,
  markPostRegenLimitAlerted,
  buildPublishAt,
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

beforeEach(async () => {
  db = await createTestDb()
  await seedTestClient(db, CLIENT_ID)
})

describe("insertPosts", () => {
  it("inserts rows into the posts table", async () => {
    const rows = [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12" }),
    ]

    await insertPosts(db, rows)

    const result = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(result).toHaveLength(2)
    expect(result[0].status).toBe("draft")
    expect(result[0].clientId).toBe(CLIENT_ID)
  })

  it("inherits rejection count", async () => {
    const rows = [
      makePostRow({ platform: "instagram", rejectionCount: 2 }),
    ]

    await insertPosts(db, rows)

    const result = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(result[0].rejectionCount).toBe(2)
  })
})

describe("getPostsByDateRange", () => {
  it("returns posts within the date range", async () => {
    await insertPosts(db, [
      makePostRow({ scheduledDate: "2026-05-12" }),
      makePostRow({ scheduledDate: "2026-05-14" }),
      makePostRow({ scheduledDate: "2026-05-20" }),
    ])

    const result = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(result).toHaveLength(2)
  })

  it("filters by client ID", async () => {
    await seedTestClient(db, "other-client")
    await insertPosts(db, [
      makePostRow({ scheduledDate: "2026-05-12" }),
      { ...makePostRow({ scheduledDate: "2026-05-12" }), clientId: "other-client" },
    ])

    const result = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(result).toHaveLength(1)
    expect(result[0].clientId).toBe(CLIENT_ID)
  })

  it("returns empty array when no posts exist", async () => {
    const result = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(result).toHaveLength(0)
  })
})

describe("readRejectionCounts", () => {
  it("returns empty map when no rejected posts exist", async () => {
    await insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "draft" }),
    ])

    const counts = await readRejectionCounts(db, CLIENT_ID, ["2026-05-12"])
    expect(counts.size).toBe(0)
  })

  it("returns rejection counts from rejected posts without deleting them", async () => {
    await insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "rejected", rejectionCount: 2 }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", status: "rejected", rejectionCount: 2 }),
    ])

    const counts = await readRejectionCounts(db, CLIENT_ID, ["2026-05-12"])
    expect(counts.get("2026-05-12:instagram")).toBe(2)
    expect(counts.get("2026-05-12:facebook")).toBe(2)

    // Posts still exist (read-only operation)
    const remaining = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(remaining).toHaveLength(2)
  })
})

describe("replacePostsForOpenDays", () => {
  it("deletes drafts and inserts new rows in one transaction", async () => {
    await insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "draft" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", status: "draft" }),
    ])

    const newRows = [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", content: "New IG" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", content: "New FB" }),
    ]

    await replacePostsForOpenDays(db, CLIENT_ID, ["2026-05-12"], newRows)

    const result = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(result).toHaveLength(2)
    expect(result.find((p) => p.platform === "instagram")?.content).toBe("New IG")
    expect(result.find((p) => p.platform === "facebook")?.content).toBe("New FB")
  })

  it("deletes rejected posts and inserts replacements", async () => {
    await insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "rejected", rejectionCount: 1 }),
    ])

    const newRows = [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", content: "Replacement", rejectionCount: 1 }),
    ]

    await replacePostsForOpenDays(db, CLIENT_ID, ["2026-05-12"], newRows)

    const result = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe("Replacement")
    expect(result[0].rejectionCount).toBe(1)
  })

  it("does NOT delete approved posts", async () => {
    await insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "approved" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", status: "approved" }),
    ])

    await replacePostsForOpenDays(db, CLIENT_ID, ["2026-05-12"], [])

    const remaining = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(remaining).toHaveLength(2)
  })

  it("does NOT delete published or failed posts", async () => {
    await insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "published" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", status: "failed" }),
    ])

    await replacePostsForOpenDays(db, CLIENT_ID, ["2026-05-12"], [])

    const remaining = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(remaining).toHaveLength(2)
  })
})

describe("getLockedDays", () => {
  it("returns days with approved posts", async () => {
    await insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "approved" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", status: "approved" }),
    ])

    const locked = await getLockedDays(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(locked).toHaveLength(1)
    expect(locked[0].scheduledDate).toBe("2026-05-12")
  })

  it("reports hasPhoto correctly", async () => {
    await seedTestPhoto(db, CLIENT_ID, "photo-1")
    await insertPosts(db, [
      makePostRow({ scheduledDate: "2026-05-12", status: "approved", photoId: "photo-1" }),
      makePostRow({ scheduledDate: "2026-05-13", status: "published", photoId: null }),
    ])

    const locked = await getLockedDays(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(locked).toHaveLength(2)

    const withPhoto = locked.find((d) => d.scheduledDate === "2026-05-12")
    const withoutPhoto = locked.find((d) => d.scheduledDate === "2026-05-13")
    expect(withPhoto?.hasPhoto).toBe(true)
    expect(withoutPhoto?.hasPhoto).toBe(false)
  })

  it("does NOT include draft or rejected days", async () => {
    await insertPosts(db, [
      makePostRow({ scheduledDate: "2026-05-12", status: "draft" }),
      makePostRow({ scheduledDate: "2026-05-13", status: "rejected" }),
    ])

    const locked = await getLockedDays(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(locked).toHaveLength(0)
  })
})

describe("getPostById", () => {
  it("finds a post by id and clientId", async () => {
    await insertPosts(db, [makePostRow({ platform: "instagram", scheduledDate: "2026-05-12" })])
    const all = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = await getPostById(db, postId, CLIENT_ID)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(postId)
    expect(result!.clientId).toBe(CLIENT_ID)
  })

  it("returns null for wrong clientId", async () => {
    await insertPosts(db, [makePostRow({ platform: "instagram", scheduledDate: "2026-05-12" })])
    const all = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    await seedTestClient(db, "other-client")
    const result = await getPostById(db, postId, "other-client")
    expect(result).toBeNull()
  })

  it("returns null for non-existent id", async () => {
    const result = await getPostById(db, "non-existent-id", CLIENT_ID)
    expect(result).toBeNull()
  })
})

describe("approvePost", () => {
  it("sets status to approved and records approvedAt", async () => {
    await insertPosts(db, [makePostRow({ platform: "instagram", scheduledDate: "2026-05-12" })])
    const all = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = await approvePost(db, postId, CLIENT_ID)
    expect(result.status).toBe("approved")
    expect(result.approvedAt).toBeInstanceOf(Date)
    expect(result.publishAt).toBeInstanceOf(Date)
  })

  it("updates content when provided", async () => {
    await insertPosts(db, [makePostRow({ content: "Original content" })])
    const all = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = await approvePost(db, postId, CLIENT_ID, "Edited content")
    expect(result.content).toBe("Edited content")
    expect(result.status).toBe("approved")
  })

  it("keeps original content when newContent is not provided", async () => {
    await insertPosts(db, [makePostRow({ content: "Original content" })])
    const all = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = await approvePost(db, postId, CLIENT_ID)
    expect(result.content).toBe("Original content")
  })

  it("throws for wrong clientId", async () => {
    await insertPosts(db, [makePostRow()])
    const all = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    await seedTestClient(db, "other-client")
    await expect(approvePost(db, postId, "other-client")).rejects.toThrow("Post not found")
  })

  it("throws when post is not draft", async () => {
    await insertPosts(db, [makePostRow({ status: "rejected" })])
    const all = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    await expect(approvePost(db, postId, CLIENT_ID)).rejects.toThrow("Cannot approve post")
  })
})

describe("rejectPost", () => {
  it("sets status to rejected and records rejectedAt", async () => {
    await insertPosts(db, [makePostRow()])
    const all = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = await rejectPost(db, postId, CLIENT_ID)
    expect(result.status).toBe("rejected")
    expect(result.rejectedAt).toBeInstanceOf(Date)
  })

  it("increments rejectionCount", async () => {
    await insertPosts(db, [makePostRow({ rejectionCount: 0 })])
    const all = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = await rejectPost(db, postId, CLIENT_ID)
    expect(result.rejectionCount).toBe(1)
  })

  it("throws when post is not draft", async () => {
    await insertPosts(db, [makePostRow({ status: "approved" })])
    const all = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    await expect(rejectPost(db, postId, CLIENT_ID)).rejects.toThrow("Cannot reject post")
  })

  it("throws for non-existent post", async () => {
    await expect(rejectPost(db, "non-existent", CLIENT_ID)).rejects.toThrow("Post not found")
  })
})

describe("regeneratePost", () => {
  it("updates content and reasoning in place", async () => {
    await insertPosts(db, [makePostRow({ content: "Old content", reasoning: "Old reasoning" })])
    const all = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = await regeneratePost(db, postId, CLIENT_ID, "New content", "New reasoning")
    expect(result.content).toBe("New content")
    expect(result.reasoning).toBe("New reasoning")
  })

  it("increments rejectionCount", async () => {
    await insertPosts(db, [makePostRow({ rejectionCount: 1 })])
    const all = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = await regeneratePost(db, postId, CLIENT_ID, "New", "New")
    expect(result.rejectionCount).toBe(2)
  })

  it("keeps the same post id", async () => {
    await insertPosts(db, [makePostRow()])
    const all = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = await regeneratePost(db, postId, CLIENT_ID, "New", "New")
    expect(result.id).toBe(postId)
  })

  it("keeps draft status", async () => {
    await insertPosts(db, [makePostRow({ status: "draft" })])
    const all = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    const result = await regeneratePost(db, postId, CLIENT_ID, "New", "New")
    expect(result.status).toBe("draft")
  })

  it("throws when post is not draft", async () => {
    await insertPosts(db, [makePostRow({ status: "rejected" })])
    const all = await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    const postId = all[0].id

    await expect(
      regeneratePost(db, postId, CLIENT_ID, "New", "New")
    ).rejects.toThrow("Cannot regenerate post")
  })

  it("throws for non-existent post", async () => {
    await expect(regeneratePost(db, "non-existent", CLIENT_ID, "New", "New")).rejects.toThrow("Post not found")
  })
})

describe("foreign key enforcement", () => {
  it("cascades user deletion to client photos and posts", async () => {
    await seedTestPhoto(db, CLIENT_ID, "photo-1")
    await insertPosts(db, [makePostRow({ photoId: "photo-1" })])

    await db.delete(users).where(eq(users.id, `user-${CLIENT_ID}`))

    expect(await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")).toHaveLength(0)
  })
})

describe("markPostsAsSeen", () => {
  it("sets firstSeenAt on posts where it was NULL", async () => {
    await insertPosts(db, [makePostRow({ platform: "instagram" })])
    const post = (await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12"))[0]
    expect(post.firstSeenAt).toBeNull()

    const now = new Date("2026-05-12T10:00:00Z")
    await markPostsAsSeen(db, [post.id], CLIENT_ID, now)

    const updated = (await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12"))[0]
    expect(updated.firstSeenAt).toEqual(now)
  })

  it("does NOT overwrite an existing firstSeenAt value", async () => {
    await insertPosts(db, [makePostRow({ platform: "instagram" })])
    const post = (await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12"))[0]

    const original = new Date("2026-05-12T10:00:00Z")
    await markPostsAsSeen(db, [post.id], CLIENT_ID, original)

    const later = new Date("2026-05-13T10:00:00Z")
    await markPostsAsSeen(db, [post.id], CLIENT_ID, later)

    const updated = (await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12"))[0]
    expect(updated.firstSeenAt).toEqual(original)
  })

  it("only affects posts owned by the given client (tenant isolation)", async () => {
    const OTHER_CLIENT = "other-client-002"
    await seedTestClient(db, OTHER_CLIENT)

    await insertPosts(db, [makePostRow({ platform: "instagram" })])
    await db.insert(posts).values({
      clientId: OTHER_CLIENT,
      platform: "instagram",
      scheduledDate: "2026-05-12",
      status: "draft",
      content: "Other client post",
      reasoning: "x",
    })

    const ourPost = (await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12"))[0]
    const otherPost = (await getPostsByDateRange(db, OTHER_CLIENT, "2026-05-12", "2026-05-12"))[0]

    const now = new Date("2026-05-12T10:00:00Z")
    await markPostsAsSeen(db, [ourPost.id, otherPost.id], CLIENT_ID, now)

    const ourAfter = (await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12"))[0]
    const otherAfter = (await getPostsByDateRange(db, OTHER_CLIENT, "2026-05-12", "2026-05-12"))[0]

    expect(ourAfter.firstSeenAt).toEqual(now)
    expect(otherAfter.firstSeenAt).toBeNull() // not ours, not stamped
  })

  it("is a no-op with an empty postIds array", async () => {
    await insertPosts(db, [makePostRow({ platform: "instagram" })])
    const now = new Date("2026-05-12T10:00:00Z")
    await expect(markPostsAsSeen(db, [], CLIENT_ID, now)).resolves.not.toThrow()

    const post = (await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12"))[0]
    expect(post.firstSeenAt).toBeNull()
  })
})

describe("findStalePosts", () => {
  // Helper to insert a post and immediately patch firstSeenAt/alertedAt/status
  // via direct UPDATE, since insertPosts doesn't expose those columns.
  async function insertWithState(opts: {
    scheduledDate?: string
    platform?: Platform
    status: PostStatus
    firstSeenAt: Date | null
    alertedAt: Date | null
  }) {
    await insertPosts(db, [
      makePostRow({
        scheduledDate: opts.scheduledDate ?? "2026-05-12",
        platform: opts.platform ?? "instagram",
      }),
    ])
    const post = (await getPostsByDateRange(
      db,
      CLIENT_ID,
      opts.scheduledDate ?? "2026-05-12",
      opts.scheduledDate ?? "2026-05-12"
    )).find((p) => p.platform === (opts.platform ?? "instagram"))!

    await db.update(posts)
      .set({
        status: opts.status,
        firstSeenAt: opts.firstSeenAt,
        alertedAt: opts.alertedAt,
      })
      .where(eq(posts.id, post.id))

    return post.id
  }

  it("returns a draft post seen >24h ago with no alert", async () => {
    const cutoff = new Date("2026-05-13T10:00:00Z")
    const seenAt = new Date("2026-05-12T09:00:00Z") // 25 hours earlier

    await insertWithState({
      status: "draft",
      firstSeenAt: seenAt,
      alertedAt: null,
    })

    const stale = await findStalePosts(db, cutoff)
    expect(stale).toHaveLength(1)
  })

  it("excludes posts that are NOT draft", async () => {
    const cutoff = new Date("2026-05-13T10:00:00Z")
    const seenAt = new Date("2026-05-12T09:00:00Z")

    await insertWithState({ status: "approved", firstSeenAt: seenAt, alertedAt: null, platform: "instagram" })
    await insertWithState({ status: "rejected", firstSeenAt: seenAt, alertedAt: null, platform: "facebook" })
    await insertWithState({ status: "published", firstSeenAt: seenAt, alertedAt: null, scheduledDate: "2026-05-13" })

    expect(await findStalePosts(db, cutoff)).toHaveLength(0)
  })

  it("excludes posts where firstSeenAt is NULL", async () => {
    const cutoff = new Date("2026-05-13T10:00:00Z")

    await insertWithState({ status: "draft", firstSeenAt: null, alertedAt: null })

    expect(await findStalePosts(db, cutoff)).toHaveLength(0)
  })

  it("excludes posts seen less than 24h ago", async () => {
    const cutoff = new Date("2026-05-13T10:00:00Z")
    const seenAt = new Date("2026-05-12T15:00:00Z") // 19 hours earlier

    await insertWithState({ status: "draft", firstSeenAt: seenAt, alertedAt: null })

    expect(await findStalePosts(db, cutoff)).toHaveLength(0)
  })

  it("excludes posts that have already been alerted", async () => {
    const cutoff = new Date("2026-05-13T10:00:00Z")
    const seenAt = new Date("2026-05-12T09:00:00Z")
    const alertedAt = new Date("2026-05-12T20:00:00Z")

    await insertWithState({ status: "draft", firstSeenAt: seenAt, alertedAt })

    expect(await findStalePosts(db, cutoff)).toHaveLength(0)
  })

  it("returns multiple matching posts", async () => {
    const cutoff = new Date("2026-05-13T10:00:00Z")
    const seenAt = new Date("2026-05-12T09:00:00Z")

    await insertWithState({ status: "draft", firstSeenAt: seenAt, alertedAt: null, platform: "instagram" })
    await insertWithState({ status: "draft", firstSeenAt: seenAt, alertedAt: null, platform: "facebook" })

    expect(await findStalePosts(db, cutoff)).toHaveLength(2)
  })

  it("includes client businessName in each result row", async () => {
    const cutoff = new Date("2026-05-13T10:00:00Z")
    const seenAt = new Date("2026-05-12T09:00:00Z")

    await insertWithState({ status: "draft", firstSeenAt: seenAt, alertedAt: null })

    const stale = await findStalePosts(db, cutoff)
    expect(stale[0].businessName).toBe("Test Café")
    expect(stale[0].clientId).toBe(CLIENT_ID)
  })
})

describe("markPostAlerted", () => {
  it("sets alertedAt on the matching post", async () => {
    await insertPosts(db, [makePostRow({ platform: "instagram" })])
    const post = (await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12"))[0]

    const now = new Date("2026-05-13T10:00:00Z")
    await markPostAlerted(db, post.id, now)

    const after = (await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12"))[0]
    expect(after.alertedAt).toEqual(now)
  })

  it("does NOT overwrite an existing alertedAt", async () => {
    await insertPosts(db, [makePostRow({ platform: "instagram" })])
    const post = (await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12"))[0]

    const first = new Date("2026-05-13T10:00:00Z")
    await markPostAlerted(db, post.id, first)

    const second = new Date("2026-05-14T10:00:00Z")
    await markPostAlerted(db, post.id, second)

    const after = (await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12"))[0]
    expect(after.alertedAt).toEqual(first)
  })
})

describe("findPostsAtRegenLimit", () => {
  // Helper: insert a draft, then patch status / rejectionCount / regenLimitAlertedAt
  // via direct UPDATE (insertPosts doesn't expose those columns).
  async function insertWithState(opts: {
    scheduledDate?: string
    platform?: Platform
    status: PostStatus
    rejectionCount: number
    regenLimitAlertedAt: Date | null
  }) {
    await insertPosts(db, [
      makePostRow({
        scheduledDate: opts.scheduledDate ?? "2026-05-12",
        platform: opts.platform ?? "instagram",
      }),
    ])
    const post = (await getPostsByDateRange(
      db,
      CLIENT_ID,
      opts.scheduledDate ?? "2026-05-12",
      opts.scheduledDate ?? "2026-05-12"
    )).find((p) => p.platform === (opts.platform ?? "instagram"))!

    await db.update(posts)
      .set({
        status: opts.status,
        rejectionCount: opts.rejectionCount,
        regenLimitAlertedAt: opts.regenLimitAlertedAt,
      })
      .where(eq(posts.id, post.id))

    return post.id
  }

  it("returns a draft post with rejectionCount === 3 and no prior alert", async () => {
    await insertWithState({
      status: "draft",
      rejectionCount: 3,
      regenLimitAlertedAt: null,
    })

    const matches = await findPostsAtRegenLimit(db)
    expect(matches).toHaveLength(1)
  })

  it("returns posts where rejectionCount is greater than 3 (defensive)", async () => {
    await insertWithState({
      status: "draft",
      rejectionCount: 5,
      regenLimitAlertedAt: null,
    })

    expect(await findPostsAtRegenLimit(db)).toHaveLength(1)
  })

  it("excludes posts where rejectionCount is below 3", async () => {
    await insertWithState({ status: "draft", rejectionCount: 0, regenLimitAlertedAt: null, platform: "instagram" })
    await insertWithState({ status: "draft", rejectionCount: 1, regenLimitAlertedAt: null, platform: "facebook" })
    await insertWithState({ status: "draft", rejectionCount: 2, regenLimitAlertedAt: null, scheduledDate: "2026-05-13" })

    expect(await findPostsAtRegenLimit(db)).toHaveLength(0)
  })

  it("excludes posts that are not in draft status", async () => {
    await insertWithState({ status: "approved", rejectionCount: 3, regenLimitAlertedAt: null, platform: "instagram" })
    await insertWithState({ status: "rejected", rejectionCount: 3, regenLimitAlertedAt: null, platform: "facebook" })
    await insertWithState({ status: "published", rejectionCount: 3, regenLimitAlertedAt: null, scheduledDate: "2026-05-13" })
    await insertWithState({ status: "failed", rejectionCount: 3, regenLimitAlertedAt: null, scheduledDate: "2026-05-14" })

    expect(await findPostsAtRegenLimit(db)).toHaveLength(0)
  })

  it("excludes posts that have already been alerted", async () => {
    await insertWithState({
      status: "draft",
      rejectionCount: 3,
      regenLimitAlertedAt: new Date("2026-05-12T10:00:00Z"),
    })

    expect(await findPostsAtRegenLimit(db)).toHaveLength(0)
  })

  it("returns multiple matching posts", async () => {
    await insertWithState({ status: "draft", rejectionCount: 3, regenLimitAlertedAt: null, platform: "instagram" })
    await insertWithState({ status: "draft", rejectionCount: 3, regenLimitAlertedAt: null, platform: "facebook" })

    expect(await findPostsAtRegenLimit(db)).toHaveLength(2)
  })

  it("includes client businessName and the post's rejectionCount in each row", async () => {
    await insertWithState({
      status: "draft",
      rejectionCount: 4,
      regenLimitAlertedAt: null,
    })

    const matches = await findPostsAtRegenLimit(db)
    expect(matches[0].businessName).toBe("Test Café")
    expect(matches[0].clientId).toBe(CLIENT_ID)
    expect(matches[0].rejectionCount).toBe(4)
  })
})

describe("markPostRegenLimitAlerted", () => {
  it("sets regenLimitAlertedAt on the matching post", async () => {
    await insertPosts(db, [makePostRow({ platform: "instagram" })])
    const post = (await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12"))[0]

    const now = new Date("2026-05-13T10:00:00Z")
    await markPostRegenLimitAlerted(db, post.id, now)

    const after = (await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12"))[0]
    expect(after.regenLimitAlertedAt).toEqual(now)
  })

  it("does NOT overwrite an existing regenLimitAlertedAt", async () => {
    await insertPosts(db, [makePostRow({ platform: "instagram" })])
    const post = (await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12"))[0]

    const first = new Date("2026-05-13T10:00:00Z")
    await markPostRegenLimitAlerted(db, post.id, first)

    const second = new Date("2026-05-14T10:00:00Z")
    await markPostRegenLimitAlerted(db, post.id, second)

    const after = (await getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12"))[0]
    expect(after.regenLimitAlertedAt).toEqual(first)
  })

  it("is a no-op when the post ID does not exist", async () => {
    const now = new Date("2026-05-13T10:00:00Z")
    // Should not throw
    await expect(markPostRegenLimitAlerted(db, "nonexistent-id", now)).resolves.not.toThrow()
  })
})

describe("buildPublishAt", () => {
  it("constructs a date in the given timezone, not UTC", () => {
    // 08:00 Amsterdam on 2026-06-15 = 06:00 UTC (CEST = UTC+2)
    const result = buildPublishAt("2026-06-15", "08:00", "Europe/Amsterdam")
    expect(result.toISOString()).toBe("2026-06-15T06:00:00.000Z")
  })

  it("handles winter time correctly (CET = UTC+1)", () => {
    // 08:00 Amsterdam on 2026-01-15 = 07:00 UTC (CET = UTC+1)
    const result = buildPublishAt("2026-01-15", "08:00", "Europe/Amsterdam")
    expect(result.toISOString()).toBe("2026-01-15T07:00:00.000Z")
  })

  it("defaults to Europe/Amsterdam when timezone is empty", () => {
    // Should still interpret as Amsterdam, not UTC
    const result = buildPublishAt("2026-06-15", "08:00", "")
    expect(result.toISOString()).toBe("2026-06-15T06:00:00.000Z")
  })

  it("works for a non-European timezone", () => {
    // 08:00 New York on 2026-06-15 = 12:00 UTC (EDT = UTC-4)
    const result = buildPublishAt("2026-06-15", "08:00", "America/New_York")
    expect(result.toISOString()).toBe("2026-06-15T12:00:00.000Z")
  })

  it("handles midnight correctly", () => {
    // 00:00 Amsterdam on 2026-06-15 = 22:00 UTC on 2026-06-14 (CEST = UTC+2)
    const result = buildPublishAt("2026-06-15", "00:00", "Europe/Amsterdam")
    expect(result.toISOString()).toBe("2026-06-14T22:00:00.000Z")
  })

  it("handles times with minutes", () => {
    // 14:30 Amsterdam on 2026-06-15 = 12:30 UTC (CEST = UTC+2)
    const result = buildPublishAt("2026-06-15", "14:30", "Europe/Amsterdam")
    expect(result.toISOString()).toBe("2026-06-15T12:30:00.000Z")
  })
})
