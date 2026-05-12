import { describe, it, expect, beforeEach } from "vitest"
import { createTestDb, seedTestClient, type TestDb } from "@/test/db"
import {
  upsertConnection,
  getConnectionByClient,
  deleteConnectionByClient,
} from "../repository"

let db: TestDb
const CLIENT_ID = "test-client-001"
const OTHER_CLIENT = "other-client-002"

beforeEach(async () => {
  db = await createTestDb()
  await seedTestClient(db, CLIENT_ID)
})

function makeInput(overrides: Partial<{
  pageId: string
  pageName: string
  instagramBusinessId: string | null
  encryptedAccessToken: string
  grantedScopes: string
  expiresAt: Date | null
}> = {}) {
  return {
    clientId: CLIENT_ID,
    pageId: overrides.pageId ?? "PAGE_1",
    pageName: overrides.pageName ?? "Café Test",
    instagramBusinessId: overrides.instagramBusinessId ?? "IG_1",
    encryptedAccessToken: overrides.encryptedAccessToken ?? "encrypted-token-bytes",
    grantedScopes: overrides.grantedScopes ?? "pages_manage_posts,instagram_content_publish",
    expiresAt: overrides.expiresAt ?? null,
  }
}

describe("upsertConnection", () => {
  it("inserts a new connection row", async () => {
    await upsertConnection(db, makeInput())
    const found = await getConnectionByClient(db, CLIENT_ID)
    expect(found).not.toBeNull()
    expect(found!.pageId).toBe("PAGE_1")
    expect(found!.pageName).toBe("Café Test")
    expect(found!.instagramBusinessId).toBe("IG_1")
    expect(found!.encryptedAccessToken).toBe("encrypted-token-bytes")
  })

  it("replaces an existing row for the same (clientId, pageId)", async () => {
    await upsertConnection(db, makeInput({ encryptedAccessToken: "old" }))
    await upsertConnection(db, makeInput({ encryptedAccessToken: "new" }))
    const found = await getConnectionByClient(db, CLIENT_ID)
    expect(found!.encryptedAccessToken).toBe("new")
  })
})

describe("getConnectionByClient", () => {
  it("returns null when no connection exists", async () => {
    const found = await getConnectionByClient(db, CLIENT_ID)
    expect(found).toBeNull()
  })

  it("does not return another client's connection (tenant isolation)", async () => {
    await seedTestClient(db, OTHER_CLIENT)
    await upsertConnection(db, { ...makeInput(), clientId: OTHER_CLIENT })
    const found = await getConnectionByClient(db, CLIENT_ID)
    expect(found).toBeNull()
  })
})

describe("deleteConnectionByClient", () => {
  it("removes the row for this client", async () => {
    await upsertConnection(db, makeInput())
    await deleteConnectionByClient(db, CLIENT_ID)
    expect(await getConnectionByClient(db, CLIENT_ID)).toBeNull()
  })

  it("does not affect another client's connection (tenant isolation)", async () => {
    await seedTestClient(db, OTHER_CLIENT)
    await upsertConnection(db, makeInput())
    await upsertConnection(db, { ...makeInput(), clientId: OTHER_CLIENT })

    await deleteConnectionByClient(db, CLIENT_ID)

    expect(await getConnectionByClient(db, CLIENT_ID)).toBeNull()
    expect(await getConnectionByClient(db, OTHER_CLIENT)).not.toBeNull()
  })

  it("is a no-op when no row exists", async () => {
    await expect(deleteConnectionByClient(db, CLIENT_ID)).resolves.not.toThrow()
  })
})
