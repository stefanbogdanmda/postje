import { describe, it, expect, beforeEach } from "vitest"
import { createTestDb, seedTestClient, type TestDb } from "@/test/db"
import { posts } from "@/db/schema"
import { insertPosts } from "@/lib/posts/repository"
import { eq } from "drizzle-orm"
import {
  findFailedPosts,
  findOverduePosts,
  findRegenLimitHits,
  findStaleDrafts,
  getAttentionData,
} from "../attention"

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
})

describe("getAttentionData (empty DB)", () => {
  it("returns empty arrays for every section when nothing exists", async () => {
    const now = new Date("2026-05-12T10:00:00Z")
    const data = await getAttentionData(db, now)

    expect(data.failedPosts).toEqual([])
    expect(data.overduePosts).toEqual([])
    expect(data.staleDrafts).toEqual([])
    expect(data.regenLimitHits).toEqual([])
    expect(data.unseenDrafts).toEqual([])
    expect(data.recentRejections).toEqual([])
    expect(data.calibrationClients).toEqual([])
  })
})

describe("getAttentionData (with seeded client but no posts)", () => {
  it("returns empty post-anchored sections", async () => {
    await seedTestClient(db, "client-001")
    const now = new Date("2026-05-12T10:00:00Z")
    const data = await getAttentionData(db, now)

    expect(data.failedPosts).toEqual([])
    expect(data.overduePosts).toEqual([])
    expect(data.staleDrafts).toEqual([])
    expect(data.regenLimitHits).toEqual([])
    expect(data.unseenDrafts).toEqual([])
    expect(data.recentRejections).toEqual([])
  })
})

describe("findFailedPosts", () => {
  it("returns posts with status='failed'", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-10",
      content: "Failed post content here, this is the body of the post that did not publish.",
      reasoning: "n/a",
    }])
    const rows = await db.select().from(posts).limit(1)
    const updatedAt = new Date("2026-05-12T09:00:00Z")
    await db.update(posts)
      .set({ status: "failed", publishError: "rate limit", updatedAt })
      .where(eq(posts.id, rows[0]!.id))

    const now = new Date("2026-05-12T10:00:00Z")
    const items = await findFailedPosts(db, now)

    expect(items).toHaveLength(1)
    expect(items[0]!.signalType).toBe("failed")
    expect(items[0]!.postId).toBe(rows[0]!.id)
    expect(items[0]!.clientId).toBe("client-001")
    expect(items[0]!.businessName).toBe("Test Café")
    expect(items[0]!.platform).toBe("instagram")
    expect(items[0]!.scheduledDate).toBe("2026-05-10")
    expect(items[0]!.signalAt).toEqual(updatedAt)
    expect(items[0]!.contentPreview.length).toBeLessThanOrEqual(80)
  })

  it("also returns posts with non-null publishError even if status is not failed", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "facebook",
      scheduledDate: "2026-05-11",
      content: "Approved but publish error",
      reasoning: "n/a",
    }])
    const rows = await db.select().from(posts).limit(1)
    await db.update(posts)
      .set({ status: "approved", publishError: "blocked by meta" })
      .where(eq(posts.id, rows[0]!.id))

    const items = await findFailedPosts(db, new Date("2026-05-12T10:00:00Z"))

    expect(items).toHaveLength(1)
  })

  it("does not return healthy drafts or successfully published posts", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [
      {
        clientId: "client-001",
        platform: "instagram",
        scheduledDate: "2026-05-10",
        content: "ok draft",
        reasoning: "n/a",
      },
      {
        clientId: "client-001",
        platform: "facebook",
        scheduledDate: "2026-05-10",
        content: "ok published",
        reasoning: "n/a",
      },
    ])
    await db.update(posts)
      .set({ status: "published", publishedAt: new Date("2026-05-10T10:00:00Z") })
      .where(eq(posts.platform, "facebook"))

    const items = await findFailedPosts(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })

  it("sorts oldest-signal-first across multiple clients", async () => {
    await seedTestClient(db, "client-001")
    await seedTestClient(db, "client-002")

    await insertPosts(db, [
      { clientId: "client-001", platform: "instagram", scheduledDate: "2026-05-10", content: "A", reasoning: "n/a" },
      { clientId: "client-002", platform: "instagram", scheduledDate: "2026-05-10", content: "B", reasoning: "n/a" },
    ])
    await db.update(posts)
      .set({ status: "failed", updatedAt: new Date("2026-05-12T09:00:00Z") })
      .where(eq(posts.clientId, "client-001"))
    await db.update(posts)
      .set({ status: "failed", updatedAt: new Date("2026-05-12T05:00:00Z") })
      .where(eq(posts.clientId, "client-002"))

    const items = await findFailedPosts(db, new Date("2026-05-12T10:00:00Z"))

    expect(items.map((i) => i.clientId)).toEqual(["client-002", "client-001"])
  })
})

describe("findOverduePosts", () => {
  it("returns approved posts whose publishAt is in the past and not yet published", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-10",
      content: "Overdue post",
      reasoning: "n/a",
    }])
    const publishAt = new Date("2026-05-10T09:00:00Z")
    await db.update(posts)
      .set({ status: "approved", publishAt, approvedAt: new Date("2026-05-09T10:00:00Z") })

    const items = await findOverduePosts(db, new Date("2026-05-12T10:00:00Z"))

    expect(items).toHaveLength(1)
    expect(items[0]!.signalType).toBe("overdue")
    expect(items[0]!.signalAt).toEqual(publishAt)
  })

  it("excludes approved posts scheduled for the future", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-20",
      content: "Future approved",
      reasoning: "n/a",
    }])
    await db.update(posts)
      .set({ status: "approved", publishAt: new Date("2026-05-20T09:00:00Z") })

    const items = await findOverduePosts(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })

  it("excludes published posts even if publishAt is in the past", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-10",
      content: "Published",
      reasoning: "n/a",
    }])
    await db.update(posts)
      .set({
        status: "published",
        publishAt: new Date("2026-05-10T09:00:00Z"),
        publishedAt: new Date("2026-05-10T09:01:00Z"),
      })

    const items = await findOverduePosts(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })

  it("excludes drafts (only approved counts)", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-10",
      content: "Draft past publishAt",
      reasoning: "n/a",
    }])
    await db.update(posts)
      .set({ publishAt: new Date("2026-05-10T09:00:00Z") })

    const items = await findOverduePosts(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })
})

describe("findStaleDrafts", () => {
  it("returns draft posts where alertedAt is set", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-12",
      content: "Stale draft",
      reasoning: "n/a",
    }])
    const alertedAt = new Date("2026-05-12T05:00:00Z")
    await db.update(posts)
      .set({ firstSeenAt: new Date("2026-05-11T05:00:00Z"), alertedAt })

    const items = await findStaleDrafts(db, new Date("2026-05-12T10:00:00Z"))

    expect(items).toHaveLength(1)
    expect(items[0]!.signalType).toBe("stale")
    expect(items[0]!.signalAt).toEqual(alertedAt)
  })

  it("excludes drafts that were never alerted", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-12",
      content: "Not yet alerted",
      reasoning: "n/a",
    }])

    const items = await findStaleDrafts(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })

  it("excludes approved or published posts even if alertedAt was set earlier", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-12",
      content: "Now approved",
      reasoning: "n/a",
    }])
    await db.update(posts)
      .set({ status: "approved", alertedAt: new Date("2026-05-12T05:00:00Z") })

    const items = await findStaleDrafts(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })

  it("sorts oldest alert first", async () => {
    await seedTestClient(db, "client-001")
    await seedTestClient(db, "client-002")
    await insertPosts(db, [
      { clientId: "client-001", platform: "instagram", scheduledDate: "2026-05-12", content: "Newer", reasoning: "n/a" },
      { clientId: "client-002", platform: "instagram", scheduledDate: "2026-05-12", content: "Older", reasoning: "n/a" },
    ])
    await db.update(posts).set({ alertedAt: new Date("2026-05-12T07:00:00Z") }).where(eq(posts.clientId, "client-001"))
    await db.update(posts).set({ alertedAt: new Date("2026-05-12T03:00:00Z") }).where(eq(posts.clientId, "client-002"))

    const items = await findStaleDrafts(db, new Date("2026-05-12T10:00:00Z"))
    expect(items.map((i) => i.clientId)).toEqual(["client-002", "client-001"])
  })
})

describe("findRegenLimitHits", () => {
  it("returns posts where regenLimitAlertedAt is set and status is draft", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-12",
      content: "Regen-limit hit",
      reasoning: "n/a",
    }])
    const at = new Date("2026-05-12T06:00:00Z")
    await db.update(posts).set({ regenLimitAlertedAt: at, rejectionCount: 3 })

    const items = await findRegenLimitHits(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toHaveLength(1)
    expect(items[0]!.signalType).toBe("regen-limit")
    expect(items[0]!.signalAt).toEqual(at)
  })

  it("excludes posts whose status is approved or published", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-12",
      content: "Approved after regen-limit",
      reasoning: "n/a",
    }])
    await db.update(posts).set({
      status: "approved",
      regenLimitAlertedAt: new Date("2026-05-12T06:00:00Z"),
    })

    const items = await findRegenLimitHits(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })

  it("excludes posts where regenLimitAlertedAt is null", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-12",
      content: "No regen alert",
      reasoning: "n/a",
    }])

    const items = await findRegenLimitHits(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })
})
