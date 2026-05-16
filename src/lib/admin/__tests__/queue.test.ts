import { describe, it, expect, beforeEach } from "vitest"
import { createTestDb, seedTestClient, seedTestPhoto, type TestDb } from "@/test/db"
import { getQueueItems } from "../queue"
import * as schema from "@/db/schema"

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
})

describe("getQueueItems", () => {
  it("returns an empty array when nothing is queued", async () => {
    await seedTestClient(db, "client-1")
    const items = await getQueueItems(db)
    expect(items).toEqual([])
  })

  it("returns approved-but-unpublished posts sorted by publishAt asc", async () => {
    await seedTestClient(db, "client-a")
    await seedTestClient(db, "client-b")

    await db.insert(schema.posts).values([
      {
        id: "p-late",
        clientId: "client-a",
        platform: "facebook",
        scheduledDate: "2026-05-20",
        status: "approved",
        content: "Late one",
        reasoning: "test",
        publishAt: new Date("2026-05-20T12:00:00Z"),
      },
      {
        id: "p-early",
        clientId: "client-b",
        platform: "instagram",
        scheduledDate: "2026-05-18",
        status: "approved",
        content: "Early one",
        reasoning: "test",
        publishAt: new Date("2026-05-18T09:00:00Z"),
      },
    ])

    const items = await getQueueItems(db)
    expect(items).toHaveLength(2)
    expect(items[0].postId).toBe("p-early")
    expect(items[1].postId).toBe("p-late")
    expect(items[0].businessName).toBe("Test Café")
    expect(items[0].platform).toBe("instagram")
  })

  it("excludes draft, rejected, published, and failed posts", async () => {
    await seedTestClient(db, "client-x")
    for (const [id, status, date] of [
      ["p-draft", "draft", "2026-05-20"],
      ["p-rejected", "rejected", "2026-05-21"],
      ["p-published", "published", "2026-05-22"],
      ["p-failed", "failed", "2026-05-23"],
    ] as const) {
      await db.insert(schema.posts).values({
        id,
        clientId: "client-x",
        platform: "facebook",
        scheduledDate: date,
        status,
        content: id,
        reasoning: "test",
      })
    }

    const items = await getQueueItems(db)
    expect(items).toEqual([])
  })

  it("includes the photo URL when the post has a photo", async () => {
    await seedTestClient(db, "client-p")
    await seedTestPhoto(db, "client-p", "photo-q")
    await db.insert(schema.posts).values({
      id: "p-photo",
      clientId: "client-p",
      platform: "instagram",
      scheduledDate: "2026-05-20",
      status: "approved",
      content: "with photo",
      reasoning: "test",
      photoId: "photo-q",
      publishAt: new Date("2026-05-20T10:00:00Z"),
    })

    const items = await getQueueItems(db)
    expect(items).toHaveLength(1)
    expect(items[0].photoUrl).toContain("photo-q")
  })
})
