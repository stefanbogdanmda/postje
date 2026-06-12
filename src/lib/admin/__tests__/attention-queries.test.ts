import { describe, it, expect, beforeEach } from "vitest"
import { createTestDb, type TestDb } from "@/test/db"
import * as schema from "@/db/schema"
import { findCalibrationClients } from "../attention-queries"

const DAY = 24 * 60 * 60 * 1000

let db: TestDb

async function insertClient(opts: {
  id: string
  createdAt: Date
  calibrationStartDate: Date | null
}) {
  await db.insert(schema.users).values({
    id: `user-${opts.id}`,
    email: `${opts.id}@example.com`,
    role: "client",
  })
  await db.insert(schema.clients).values({
    id: opts.id,
    userId: `user-${opts.id}`,
    businessName: `Business ${opts.id}`,
    createdAt: opts.createdAt,
    calibrationStartDate: opts.calibrationStartDate,
  })
}

describe("findCalibrationClients", () => {
  beforeEach(async () => {
    db = await createTestDb()
  })

  it("includes a client whose calibrationStartDate is within 14 days", async () => {
    await insertClient({
      id: "fresh",
      createdAt: new Date(Date.now() - 30 * DAY),
      calibrationStartDate: new Date(Date.now() - 3 * DAY),
    })
    const items = await findCalibrationClients(db)
    expect(items.map((i) => i.clientId)).toEqual(["fresh"])
    expect(items[0].daysInCalibration).toBe(3)
  })

  it("excludes a client whose calibrationStartDate is older than 14 days", async () => {
    await insertClient({
      id: "graduated",
      createdAt: new Date(Date.now() - 30 * DAY),
      calibrationStartDate: new Date(Date.now() - 20 * DAY),
    })
    const items = await findCalibrationClients(db)
    expect(items).toEqual([])
  })

  it("falls back to createdAt when calibrationStartDate is null", async () => {
    await insertClient({
      id: "legacy-in",
      createdAt: new Date(Date.now() - 5 * DAY),
      calibrationStartDate: null,
    })
    await insertClient({
      id: "legacy-out",
      createdAt: new Date(Date.now() - 40 * DAY),
      calibrationStartDate: null,
    })
    const items = await findCalibrationClients(db)
    expect(items.map((i) => i.clientId)).toEqual(["legacy-in"])
  })

  it("counts the client's pending (draft) posts", async () => {
    await insertClient({
      id: "withdrafts",
      createdAt: new Date(Date.now() - 1 * DAY),
      calibrationStartDate: new Date(Date.now() - 1 * DAY),
    })
    await db.insert(schema.posts).values([
      {
        clientId: "withdrafts",
        platform: "instagram",
        scheduledDate: "2026-05-12",
        status: "draft",
        content: "a",
        reasoning: "r",
      },
      {
        clientId: "withdrafts",
        platform: "facebook",
        scheduledDate: "2026-05-12",
        status: "approved",
        content: "b",
        reasoning: "r",
      },
    ])
    const items = await findCalibrationClients(db)
    expect(items[0].pendingPostCount).toBe(1)
  })
})
