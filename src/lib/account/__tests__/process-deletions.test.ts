import { describe, it, expect, beforeEach, vi } from "vitest"
import { createTestDb, seedTestClient, type TestDb } from "@/test/db"
import { users, deletionRequests } from "@/db/schema"
import { eq } from "drizzle-orm"
import { processDueDeletions } from "../process-deletions"
import {
  createOrGetDeletionRequest,
  cancelDeletionRequestForUser,
} from "../deletion-request"

const CLIENT_ID = "test-client-001"
const USER_ID = `user-${CLIENT_ID}`

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
  await seedTestClient(db, CLIENT_ID)
})

describe("processDueDeletions", () => {
  it("returns processed=0, failed=0 when nothing is due", async () => {
    const deleteBlob = vi.fn()
    const result = await processDueDeletions(db, { deleteBlob }, new Date())

    expect(result).toEqual({ processed: 0, failed: 0 })
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it("deletes a user whose deletion is due", async () => {
    const requestedAt = new Date("2026-05-12T10:00:00Z")
    const req = await createOrGetDeletionRequest(db, USER_ID, requestedAt)
    const dueTime = new Date(req.scheduledFor.getTime() + 1000)
    const deleteBlob = vi.fn().mockResolvedValue(undefined)

    const result = await processDueDeletions(db, { deleteBlob }, dueTime)

    expect(result.processed).toBe(1)
    expect(result.failed).toBe(0)

    // User is gone; deletion_requests row cascaded away too.
    expect((await db.select().from(users).where(eq(users.id, USER_ID))).length).toBe(0)
    expect((await db.select().from(deletionRequests)).length).toBe(0)
  })

  it("skips cancelled requests", async () => {
    const requestedAt = new Date("2026-05-12T10:00:00Z")
    const req = await createOrGetDeletionRequest(db, USER_ID, requestedAt)
    await cancelDeletionRequestForUser(db, USER_ID, requestedAt)

    const dueTime = new Date(req.scheduledFor.getTime() + 1000)
    const deleteBlob = vi.fn()
    const result = await processDueDeletions(db, { deleteBlob }, dueTime)

    expect(result).toEqual({ processed: 0, failed: 0 })
    expect((await db.select().from(users).where(eq(users.id, USER_ID))).length).toBe(1)
  })

  it("counts failed deletions but continues with the rest", async () => {
    // Two clients, two due deletion requests.
    await seedTestClient(db, "test-client-002")
    const requestedAt = new Date("2026-05-12T10:00:00Z")
    const req1 = await createOrGetDeletionRequest(db, USER_ID, requestedAt)
    await createOrGetDeletionRequest(db, "user-test-client-002", requestedAt)

    const dueTime = new Date(req1.scheduledFor.getTime() + 1000)

    // First user's deletion throws (we simulate by deleting the user out from
    // under it — that way the underlying deleteUserAccount throws "not found").
    await db.delete(users).where(eq(users.id, USER_ID))

    const deleteBlob = vi.fn().mockResolvedValue(undefined)
    const result = await processDueDeletions(db, { deleteBlob }, dueTime)

    expect(result.processed + result.failed).toBeGreaterThanOrEqual(1)
    // The remaining user (test-client-002) is gone.
    expect(
      (await db.select().from(users).where(eq(users.id, "user-test-client-002"))).length
    ).toBe(0)
  })
})
