import { describe, it, expect, beforeEach } from "vitest"
import { createTestDb, seedTestClient, type TestDb } from "@/test/db"
import { deletionRequests } from "@/db/schema"
import { eq } from "drizzle-orm"
import {
  createOrGetDeletionRequest,
  getActiveDeletionRequest,
  cancelDeletionRequestByToken,
  cancelDeletionRequestForUser,
  findDueDeletionRequests,
  markDeletionCompleted,
  DELETION_COOLING_OFF_MS,
} from "../deletion-request"

const CLIENT_ID = "test-client-001"
const USER_ID = `user-${CLIENT_ID}`

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
  await seedTestClient(db, CLIENT_ID)
})

describe("createOrGetDeletionRequest", () => {
  it("inserts a row scheduled DELETION_COOLING_OFF_MS in the future", async () => {
    const now = new Date("2026-05-12T10:00:00Z")

    const req = await createOrGetDeletionRequest(db, USER_ID, now)

    expect(req.userId).toBe(USER_ID)
    expect(req.scheduledFor.getTime()).toBe(now.getTime() + DELETION_COOLING_OFF_MS)
    expect(req.cancelToken).toMatch(/^[0-9a-f-]{36}$/)
    expect(req.cancelledAt).toBeNull()
    expect(req.completedAt).toBeNull()
  })

  it("is idempotent — second call returns the existing row", async () => {
    const now = new Date("2026-05-12T10:00:00Z")

    const first = await createOrGetDeletionRequest(db, USER_ID, now)
    const later = new Date("2026-05-12T11:00:00Z")
    const second = await createOrGetDeletionRequest(db, USER_ID, later)

    expect(second.id).toBe(first.id)
    expect(second.scheduledFor.getTime()).toBe(first.scheduledFor.getTime())
    expect(second.cancelToken).toBe(first.cancelToken)
  })

  it("treats a cancelled request as no longer active — creates a fresh row", async () => {
    const now = new Date("2026-05-12T10:00:00Z")
    const first = await createOrGetDeletionRequest(db, USER_ID, now)
    await cancelDeletionRequestForUser(db, USER_ID, new Date("2026-05-12T10:30:00Z"))

    const later = new Date("2026-05-12T11:00:00Z")
    const second = await createOrGetDeletionRequest(db, USER_ID, later)

    expect(second.id).not.toBe(first.id)
    expect(second.cancelToken).not.toBe(first.cancelToken)
    expect(second.cancelledAt).toBeNull()
  })
})

describe("getActiveDeletionRequest", () => {
  it("returns null when there is no request", async () => {
    const result = await getActiveDeletionRequest(db, USER_ID)
    expect(result).toBeNull()
  })

  it("returns the request when active", async () => {
    const now = new Date("2026-05-12T10:00:00Z")
    await createOrGetDeletionRequest(db, USER_ID, now)

    const result = await getActiveDeletionRequest(db, USER_ID)
    expect(result).not.toBeNull()
    expect(result?.userId).toBe(USER_ID)
  })

  it("returns null after the request is cancelled", async () => {
    const now = new Date("2026-05-12T10:00:00Z")
    await createOrGetDeletionRequest(db, USER_ID, now)
    await cancelDeletionRequestForUser(db, USER_ID, new Date())

    const result = await getActiveDeletionRequest(db, USER_ID)
    expect(result).toBeNull()
  })

  it("returns null after the request is completed", async () => {
    const now = new Date("2026-05-12T10:00:00Z")
    const req = await createOrGetDeletionRequest(db, USER_ID, now)
    await markDeletionCompleted(db, req.id, new Date())

    const result = await getActiveDeletionRequest(db, USER_ID)
    expect(result).toBeNull()
  })
})

describe("cancelDeletionRequestByToken", () => {
  it("cancels a fresh token and returns cancelled=true", async () => {
    const now = new Date("2026-05-12T10:00:00Z")
    const req = await createOrGetDeletionRequest(db, USER_ID, now)

    const cancelAt = new Date("2026-05-12T10:30:00Z")
    const result = await cancelDeletionRequestByToken(db, req.cancelToken, cancelAt)

    expect(result.cancelled).toBe(true)

    const rows = await db
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.id, req.id))
    expect(rows[0]?.cancelledAt?.getTime()).toBe(cancelAt.getTime())
  })

  it("returns cancelled=false for an unknown token", async () => {
    const result = await cancelDeletionRequestByToken(
      db,
      "00000000-0000-0000-0000-000000000000",
      new Date()
    )
    expect(result.cancelled).toBe(false)
  })

  it("returns cancelled=false when re-cancelling an already-cancelled row", async () => {
    const now = new Date("2026-05-12T10:00:00Z")
    const req = await createOrGetDeletionRequest(db, USER_ID, now)
    await cancelDeletionRequestByToken(db, req.cancelToken, new Date())

    const result = await cancelDeletionRequestByToken(db, req.cancelToken, new Date())
    expect(result.cancelled).toBe(false)
  })

  it("returns cancelled=false for a completed row", async () => {
    const now = new Date("2026-05-12T10:00:00Z")
    const req = await createOrGetDeletionRequest(db, USER_ID, now)
    await markDeletionCompleted(db, req.id, new Date())

    const result = await cancelDeletionRequestByToken(db, req.cancelToken, new Date())
    expect(result.cancelled).toBe(false)
  })
})

describe("findDueDeletionRequests", () => {
  it("returns nothing when no requests exist", async () => {
    const result = await findDueDeletionRequests(db, new Date())
    expect(result).toEqual([])
  })

  it("returns nothing when the scheduledFor is in the future", async () => {
    const now = new Date("2026-05-12T10:00:00Z")
    await createOrGetDeletionRequest(db, USER_ID, now)

    const result = await findDueDeletionRequests(db, now)
    expect(result).toEqual([])
  })

  it("returns the request once scheduledFor has passed", async () => {
    const now = new Date("2026-05-12T10:00:00Z")
    const req = await createOrGetDeletionRequest(db, USER_ID, now)
    const later = new Date(req.scheduledFor.getTime() + 1000)

    const result = await findDueDeletionRequests(db, later)
    expect(result).toHaveLength(1)
    expect(result[0]?.userId).toBe(USER_ID)
  })

  it("excludes cancelled requests even if past their scheduledFor", async () => {
    const now = new Date("2026-05-12T10:00:00Z")
    const req = await createOrGetDeletionRequest(db, USER_ID, now)
    await cancelDeletionRequestForUser(db, USER_ID, now)

    const later = new Date(req.scheduledFor.getTime() + 1000)
    const result = await findDueDeletionRequests(db, later)
    expect(result).toEqual([])
  })

  it("excludes completed requests", async () => {
    const now = new Date("2026-05-12T10:00:00Z")
    const req = await createOrGetDeletionRequest(db, USER_ID, now)
    await markDeletionCompleted(db, req.id, new Date())

    const later = new Date(req.scheduledFor.getTime() + 1000)
    const result = await findDueDeletionRequests(db, later)
    expect(result).toEqual([])
  })
})

describe("markDeletionCompleted", () => {
  it("stamps completedAt on the row", async () => {
    const now = new Date("2026-05-12T10:00:00Z")
    const req = await createOrGetDeletionRequest(db, USER_ID, now)

    const completedAt = new Date("2026-05-13T10:00:00Z")
    await markDeletionCompleted(db, req.id, completedAt)

    const rows = await db
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.id, req.id))
    expect(rows[0]?.completedAt?.getTime()).toBe(completedAt.getTime())
  })
})
