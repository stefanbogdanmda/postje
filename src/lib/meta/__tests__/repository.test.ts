import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { createTestDb, seedTestClient, type TestDb } from "@/test/db"
import {
  upsertConnection,
  getConnectionByClient,
  deleteConnectionByClient,
  getDecryptedConnectionByClient,
  insertPublishAttempt,
} from "../repository"
import { encryptToken } from "../crypto"
import * as schema from "@/db/schema"

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

const ORIGINAL_ENCRYPTION_KEY = process.env.META_TOKEN_ENCRYPTION_KEY

describe("getDecryptedConnectionByClient", () => {
  beforeEach(() => {
    process.env.META_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
  })

  afterAll(() => {
    process.env.META_TOKEN_ENCRYPTION_KEY = ORIGINAL_ENCRYPTION_KEY
  })

  it("returns null when no connection exists", async () => {
    const result = await getDecryptedConnectionByClient(db, CLIENT_ID)
    expect(result).toBeNull()
  })

  it("returns the connection with decrypted token", async () => {
    const encrypted = encryptToken("real-page-token-xyz")
    await upsertConnection(db, makeInput({ encryptedAccessToken: encrypted }))

    const result = await getDecryptedConnectionByClient(db, CLIENT_ID)
    expect(result).not.toBeNull()
    expect(result!.accessToken).toBe("real-page-token-xyz")
    expect(result!.pageId).toBe("PAGE_1")
    expect(result!.instagramBusinessId).toBe("IG_1")
  })
})

describe("insertPublishAttempt", () => {
  it("writes a success attempt row", async () => {
    const postId = "post-1"
    await db.insert(schema.posts).values({
      id: postId,
      clientId: CLIENT_ID,
      platform: "facebook",
      scheduledDate: "2026-05-20",
      status: "approved",
      content: "Hello",
      reasoning: "test",
    })

    await insertPublishAttempt(db, {
      postId,
      attemptedBy: "user-admin",
      success: true,
      metaPostId: "META_POST_99",
      requestDurationMs: 250,
    })

    const rows = await db.select().from(schema.publishAttempts)
    expect(rows).toHaveLength(1)
    expect(rows[0].success).toBe(true)
    expect(rows[0].metaPostId).toBe("META_POST_99")
  })

  it("writes a failure attempt row with error fields", async () => {
    const postId = "post-2"
    await db.insert(schema.posts).values({
      id: postId,
      clientId: CLIENT_ID,
      platform: "instagram",
      scheduledDate: "2026-05-21",
      status: "approved",
      content: "Hi",
      reasoning: "test",
    })

    await insertPublishAttempt(db, {
      postId,
      attemptedBy: "user-admin",
      success: false,
      errorClass: "content-rejected",
      errorCode: "100",
      errorMessage: "Invalid image URL",
      requestDurationMs: 180,
    })

    const rows = await db.select().from(schema.publishAttempts)
    expect(rows).toHaveLength(1)
    expect(rows[0].success).toBe(false)
    expect(rows[0].errorClass).toBe("content-rejected")
    expect(rows[0].errorMessage).toBe("Invalid image URL")
  })
})
