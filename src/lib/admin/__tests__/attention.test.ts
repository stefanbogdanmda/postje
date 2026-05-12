import { describe, it, expect, beforeEach } from "vitest"
import { createTestDb, seedTestClient, type TestDb } from "@/test/db"
import { getAttentionData } from "../attention"

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
