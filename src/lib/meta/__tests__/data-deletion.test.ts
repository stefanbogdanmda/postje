import { describe, it, expect, beforeEach } from "vitest"
import { createTestDb, type TestDb } from "@/test/db"
import { metaDeletionRequests } from "@/db/schema"
import { eq } from "drizzle-orm"
import {
  recordDeletionRequest,
  getDeletionRequestByCode,
  buildDeletionStatusResponse,
} from "../data-deletion"

describe("recordDeletionRequest / getDeletionRequestByCode", () => {
  let db: TestDb
  beforeEach(async () => {
    db = await createTestDb()
  })

  it("stores a request as 'received' and reads it back by code", async () => {
    await recordDeletionRequest(db, {
      metaUserId: "meta-user-1",
      confirmationCode: "code-abc",
    })

    const found = await getDeletionRequestByCode(db, "code-abc")
    expect(found).not.toBeNull()
    expect(found?.confirmationCode).toBe("code-abc")
    expect(found?.status).toBe("received")

    const rows = await db
      .select()
      .from(metaDeletionRequests)
      .where(eq(metaDeletionRequests.confirmationCode, "code-abc"))
    expect(rows[0].metaUserId).toBe("meta-user-1")
  })

  it("returns null for an unknown code", async () => {
    expect(await getDeletionRequestByCode(db, "nope")).toBeNull()
  })
})

describe("buildDeletionStatusResponse", () => {
  it("reports not_found (404) for an unknown code", () => {
    const res = buildDeletionStatusResponse(null, "missing")
    expect(res.httpStatus).toBe(404)
    expect(res.body.status).toBe("not_found")
    expect(res.body.confirmation_code).toBe("missing")
  })

  it("reports pending for a received request — never claims completed", () => {
    const res = buildDeletionStatusResponse(
      { confirmationCode: "c1", status: "received" },
      "c1"
    )
    expect(res.httpStatus).toBe(200)
    expect(res.body.status).toBe("pending")
    expect(res.body.message).not.toMatch(/verwijderd/i)
  })

  it("reports completed only once resolved", () => {
    const res = buildDeletionStatusResponse(
      { confirmationCode: "c2", status: "resolved" },
      "c2"
    )
    expect(res.httpStatus).toBe(200)
    expect(res.body.status).toBe("completed")
    expect(res.body.message).toMatch(/verwijderd/i)
  })
})
