import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  createTestDb,
  seedTestClient,
  seedTestPhoto,
  type TestDb,
} from "@/test/db"
import { insertPosts } from "@/lib/posts/repository"
import {
  users,
  clients,
  photos,
  posts,
  deletionAuditLog,
  deletionRequests,
} from "@/db/schema"
import { eq } from "drizzle-orm"
import { deleteUserAccount } from "../delete"
import { createOrGetDeletionRequest } from "../deletion-request"

const CLIENT_ID = "test-client-001"
const USER_ID = `user-${CLIENT_ID}`

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
  await seedTestClient(db, CLIENT_ID)
})

describe("deleteUserAccount", () => {
  it("writes an audit log row before deleting the user", async () => {
    const deleteBlob = vi.fn().mockResolvedValue(undefined)

    await deleteUserAccount(db, USER_ID, USER_ID, { deleteBlob })

    const auditRows = await db.select().from(deletionAuditLog)
    expect(auditRows).toHaveLength(1)
    expect(auditRows[0]?.deletedUserId).toBe(USER_ID)
    expect(auditRows[0]?.deletedUserEmail).toBe(`${CLIENT_ID}@example.com`)
    expect(auditRows[0]?.deletedBy).toBe(USER_ID)
  })

  it("removes the user, client, and dependent rows via FK cascade", async () => {
    await seedTestPhoto(db, CLIENT_ID, "photo-1")
    await insertPosts(db, [
      {
        clientId: CLIENT_ID,
        platform: "instagram",
        scheduledDate: "2026-05-13",
        content: "About to disappear",
        reasoning: "test",
      },
    ])

    const deleteBlob = vi.fn().mockResolvedValue(undefined)

    await deleteUserAccount(db, USER_ID, USER_ID, { deleteBlob })

    expect((await db.select().from(users)).length).toBe(0)
    expect((await db.select().from(clients)).length).toBe(0)
    expect((await db.select().from(photos)).length).toBe(0)
    expect((await db.select().from(posts)).length).toBe(0)
  })

  it("calls deleteBlob once per photo with the correct URL", async () => {
    await seedTestPhoto(db, CLIENT_ID, "photo-1")
    await seedTestPhoto(db, CLIENT_ID, "photo-2")
    await seedTestPhoto(db, CLIENT_ID, "photo-3")

    const deleteBlob = vi.fn().mockResolvedValue(undefined)

    const result = await deleteUserAccount(db, USER_ID, USER_ID, { deleteBlob })

    expect(deleteBlob).toHaveBeenCalledTimes(3)
    expect(deleteBlob.mock.calls.map((c) => c[0]).sort()).toEqual([
      "https://example.com/photo-1.jpg",
      "https://example.com/photo-2.jpg",
      "https://example.com/photo-3.jpg",
    ])
    expect(result.deletedPhotoCount).toBe(3)
    expect(result.failedBlobCount).toBe(0)
  })

  it("counts but does not abort on individual blob failures", async () => {
    await seedTestPhoto(db, CLIENT_ID, "photo-1")
    await seedTestPhoto(db, CLIENT_ID, "photo-2")
    await seedTestPhoto(db, CLIENT_ID, "photo-3")

    const deleteBlob = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("transient Vercel Blob error"))
      .mockResolvedValueOnce(undefined)

    const result = await deleteUserAccount(db, USER_ID, USER_ID, { deleteBlob })

    expect(deleteBlob).toHaveBeenCalledTimes(3)
    expect(result.deletedPhotoCount).toBe(3)
    expect(result.failedBlobCount).toBe(1)

    // User and DB rows are still gone — the blob failure does not block deletion.
    expect((await db.select().from(users)).length).toBe(0)
  })

  it("deletes a user with no photos cleanly (zero blob calls)", async () => {
    const deleteBlob = vi.fn().mockResolvedValue(undefined)

    const result = await deleteUserAccount(db, USER_ID, USER_ID, { deleteBlob })

    expect(deleteBlob).not.toHaveBeenCalled()
    expect(result.deletedPhotoCount).toBe(0)
    expect(result.failedBlobCount).toBe(0)
  })

  it("returns the deletion counts in the result", async () => {
    await seedTestPhoto(db, CLIENT_ID, "photo-1")
    await seedTestPhoto(db, CLIENT_ID, "photo-2")

    const deleteBlob = vi.fn().mockResolvedValue(undefined)
    const result = await deleteUserAccount(db, USER_ID, USER_ID, { deleteBlob })

    expect(result).toEqual({ deletedPhotoCount: 2, failedBlobCount: 0 })
  })

  it("cascades the deletion_requests row when the user is deleted", async () => {
    await createOrGetDeletionRequest(db, USER_ID, new Date())

    expect((await db.select().from(deletionRequests)).length).toBe(1)

    const deleteBlob = vi.fn().mockResolvedValue(undefined)
    await deleteUserAccount(db, USER_ID, USER_ID, { deleteBlob })

    expect((await db.select().from(deletionRequests)).length).toBe(0)
  })

  it("preserves the audit log even when blob deletion partially fails", async () => {
    await seedTestPhoto(db, CLIENT_ID, "photo-1")

    const deleteBlob = vi.fn().mockRejectedValue(new Error("boom"))

    await deleteUserAccount(db, USER_ID, USER_ID, { deleteBlob })

    const auditRows = await db.select().from(deletionAuditLog)
    expect(auditRows).toHaveLength(1)
  })

  it("throws when the user does not exist", async () => {
    const deleteBlob = vi.fn().mockResolvedValue(undefined)

    await expect(
      deleteUserAccount(db, "nonexistent-user", "admin-1", { deleteBlob })
    ).rejects.toThrow(/not found/i)
  })

  it("records deletedBy=admin id when invoked by admin", async () => {
    await db.insert(users).values({
      id: "admin-1",
      email: "admin@example.com",
      role: "admin",
    })

    const deleteBlob = vi.fn().mockResolvedValue(undefined)
    await deleteUserAccount(db, USER_ID, "admin-1", { deleteBlob })

    const audit = await db
      .select()
      .from(deletionAuditLog)
      .where(eq(deletionAuditLog.deletedUserId, USER_ID))
    expect(audit[0]?.deletedBy).toBe("admin-1")
  })
})
