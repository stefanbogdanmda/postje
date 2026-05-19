import { describe, it, expect, beforeEach } from "vitest"
import {
  createTestDb,
  seedTestClient,
  seedTestPhoto,
  type TestDb,
} from "@/test/db"
import { posts } from "@/db/schema"
import { eq } from "drizzle-orm"
import { findQueuePosts, resetFailedPostToApproved } from "../queue-repository"

const CLIENT_ID = "test-client-001"

let db: TestDb
beforeEach(async () => {
  db = await createTestDb()
  await seedTestClient(db, CLIENT_ID)
})

async function insertPost(opts: {
  status: "draft" | "approved" | "rejected" | "published" | "failed"
  scheduledDate?: string
  platform?: "instagram" | "facebook"
  publishedAt?: Date | null
  publishError?: string | null
  photoId?: string | null
}) {
  await db.insert(posts).values({
    clientId: CLIENT_ID,
    platform: opts.platform ?? "instagram",
    scheduledDate: opts.scheduledDate ?? "2026-05-12",
    status: opts.status,
    content: "x",
    reasoning: "x",
    publishAt: new Date(opts.scheduledDate ?? "2026-05-12"),
    publishedAt: opts.publishedAt ?? null,
    publishError: opts.publishError ?? null,
    photoId: opts.photoId ?? null,
  })
  const all = await db.select().from(posts).where(eq(posts.clientId, CLIENT_ID))
  return all[all.length - 1]
}

describe("findQueuePosts", () => {
  it("returns approved + failed posts without publishedAt", async () => {
    await insertPost({ status: "approved" })
    await insertPost({ status: "failed", publishError: "old error", scheduledDate: "2026-05-13" })
    await insertPost({ status: "draft", scheduledDate: "2026-05-14" })
    await insertPost({
      status: "published",
      publishedAt: new Date(),
      scheduledDate: "2026-05-15",
    })

    const queue = await findQueuePosts(db)
    expect(queue).toHaveLength(2)
    expect(queue.map((p) => p.status).sort()).toEqual(["approved", "failed"])
  })

  it("sorts failed first, then by publishAt ascending", async () => {
    await insertPost({ status: "approved", scheduledDate: "2026-05-12" })
    await insertPost({ status: "failed", scheduledDate: "2026-05-15", publishError: "x" })
    await insertPost({ status: "approved", scheduledDate: "2026-05-10" })
    await insertPost({ status: "failed", scheduledDate: "2026-05-13", publishError: "y" })

    const queue = await findQueuePosts(db)
    expect(queue.map((p) => p.status)).toEqual([
      "failed",
      "failed",
      "approved",
      "approved",
    ])
    expect(queue[0].scheduledDate).toBe("2026-05-13")
    expect(queue[1].scheduledDate).toBe("2026-05-15")
    expect(queue[2].scheduledDate).toBe("2026-05-10")
    expect(queue[3].scheduledDate).toBe("2026-05-12")
  })

  it("joins client businessName and photo blobUrl", async () => {
    await seedTestPhoto(db, CLIENT_ID, "photo-1")
    await insertPost({ status: "approved", photoId: "photo-1" })

    const queue = await findQueuePosts(db)
    expect(queue[0].businessName).toBe("Test Caf\u00e9")
    expect(queue[0].photoUrl).toContain("photo-1")
  })

  it("returns hasMetaConnection=false when the client has no connection", async () => {
    await insertPost({ status: "approved" })
    const queue = await findQueuePosts(db)
    expect(queue[0].hasMetaConnection).toBe(false)
  })
})

describe("resetFailedPostToApproved", () => {
  it("flips a failed post back to approved and clears the error", async () => {
    const failed = await insertPost({ status: "failed", publishError: "old" })
    await resetFailedPostToApproved(db, failed.id)
    const updated = (await db.select().from(posts).where(eq(posts.id, failed.id)))[0]
    expect(updated.status).toBe("approved")
    expect(updated.publishError).toBeNull()
  })

  it("does NOT change a published post", async () => {
    const published = await insertPost({
      status: "published",
      publishedAt: new Date(),
    })
    await resetFailedPostToApproved(db, published.id)
    const updated = (await db.select().from(posts).where(eq(posts.id, published.id)))[0]
    expect(updated.status).toBe("published")
  })

  it("does NOT change a draft post", async () => {
    const draft = await insertPost({ status: "draft" })
    await resetFailedPostToApproved(db, draft.id)
    const updated = (await db.select().from(posts).where(eq(posts.id, draft.id)))[0]
    expect(updated.status).toBe("draft")
  })
})
