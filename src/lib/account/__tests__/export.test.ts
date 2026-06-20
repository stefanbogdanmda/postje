import { describe, it, expect, beforeEach } from "vitest"
import {
  createTestDb,
  seedTestClient,
  seedTestPhoto,
  type TestDb,
} from "@/test/db"
import { insertPosts } from "@/lib/posts/repository"
import {
  deletionRequests,
  accounts,
  sessions,
  verificationTokens,
  users,
} from "@/db/schema"
import {
  buildExportJson,
  EXPORT_SCHEMA_VERSION,
} from "../export"

const CLIENT_ID = "test-client-001"
const USER_ID = `user-${CLIENT_ID}`

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
  await seedTestClient(db, CLIENT_ID)
})

describe("buildExportJson — shape", () => {
  it("returns an object with schemaVersion and exportedAt", async () => {
    const export_ = await buildExportJson(db, USER_ID, new Date("2026-05-12T10:00:00Z"))

    expect(export_.schemaVersion).toBe(EXPORT_SCHEMA_VERSION)
    expect(export_.exportedAt).toBe("2026-05-12T10:00:00.000Z")
  })

  it("includes the user record", async () => {
    const export_ = await buildExportJson(db, USER_ID, new Date())

    expect(export_.user).not.toBeNull()
    expect(export_.user?.id).toBe(USER_ID)
    expect(export_.user?.email).toBe(`${CLIENT_ID}@example.com`)
    expect(export_.user?.role).toBe("client")
  })

  it("includes the client record", async () => {
    const export_ = await buildExportJson(db, USER_ID, new Date())

    expect(export_.client).not.toBeNull()
    expect(export_.client?.id).toBe(CLIENT_ID)
    expect(export_.client?.businessName).toBe("Test Café")
  })

  it("includes photos array (empty when no photos)", async () => {
    const export_ = await buildExportJson(db, USER_ID, new Date())

    expect(export_.photos).toEqual([])
  })

  it("includes uploaded photos with their analysis", async () => {
    await seedTestPhoto(db, CLIENT_ID, "photo-1")
    await seedTestPhoto(db, CLIENT_ID, "photo-2")

    const export_ = await buildExportJson(db, USER_ID, new Date())

    expect(export_.photos).toHaveLength(2)
    expect(export_.photos[0]).toMatchObject({
      id: expect.any(String),
      blobUrl: expect.stringContaining("https://example.com/"),
      originalFilename: expect.stringMatching(/\.jpg$/),
      mimeType: "image/jpeg",
    })
  })

  it("includes posts array", async () => {
    await insertPosts(db, [
      {
        clientId: CLIENT_ID,
        platform: "instagram",
        scheduledDate: "2026-05-13",
        content: "Test post",
        reasoning: "Test reasoning",
      },
    ])

    const export_ = await buildExportJson(db, USER_ID, new Date())

    expect(export_.posts).toHaveLength(1)
    expect(export_.posts[0]).toMatchObject({
      platform: "instagram",
      scheduledDate: "2026-05-13",
      content: "Test post",
      status: "draft",
    })
  })

  it("deletionRequest is null when no active request exists", async () => {
    const export_ = await buildExportJson(db, USER_ID, new Date())

    expect(export_.deletionRequest).toBeNull()
  })

  it("deletionRequest is populated when an active request exists, WITHOUT cancelToken", async () => {
    await db.insert(deletionRequests).values({
      userId: USER_ID,
      cancelToken: "super-secret-token-do-not-leak",
      scheduledFor: new Date("2026-05-13T10:00:00Z"),
    })

    const export_ = await buildExportJson(db, USER_ID, new Date())

    expect(export_.deletionRequest).not.toBeNull()
    expect(export_.deletionRequest?.scheduledFor).toBe("2026-05-13T10:00:00.000Z")
    expect(JSON.stringify(export_)).not.toContain("super-secret-token-do-not-leak")
  })
})

describe("buildExportJson — exclusions", () => {
  it("excludes accounts, sessions, and verificationTokens", async () => {
    await db.insert(accounts).values({
      userId: USER_ID,
      type: "email",
      provider: "resend",
      providerAccountId: "resend-account-123",
    })
    await db.insert(sessions).values({
      sessionToken: "session-token-xyz",
      userId: USER_ID,
      expires: new Date("2027-01-01"),
    })
    await db.insert(verificationTokens).values({
      identifier: `${CLIENT_ID}@example.com`,
      token: "verification-token-abc",
      expires: new Date("2027-01-01"),
    })

    const export_ = await buildExportJson(db, USER_ID, new Date())
    const serialized = JSON.stringify(export_)

    expect(serialized).not.toContain("resend-account-123")
    expect(serialized).not.toContain("session-token-xyz")
    expect(serialized).not.toContain("verification-token-abc")
  })
})

describe("buildExportJson — tenant isolation", () => {
  it("scopes data to the requested userId only", async () => {
    const OTHER_CLIENT_ID = "test-client-002"
    await seedTestClient(db, OTHER_CLIENT_ID)
    await seedTestPhoto(db, OTHER_CLIENT_ID, "other-photo")
    await insertPosts(db, [
      {
        clientId: OTHER_CLIENT_ID,
        platform: "facebook",
        scheduledDate: "2026-05-13",
        content: "Other client's post — should NOT appear in test-client-001's export",
        reasoning: "leak detector",
      },
    ])

    const export_ = await buildExportJson(db, USER_ID, new Date())
    const serialized = JSON.stringify(export_)

    expect(serialized).not.toContain("Other client's post")
    expect(serialized).not.toContain("other-photo")
    expect(export_.photos).toHaveLength(0)
    expect(export_.posts).toHaveLength(0)
  })
})

describe("buildExportJson — missing data", () => {
  it("returns user null when the userId does not exist", async () => {
    const export_ = await buildExportJson(db, "nonexistent-user", new Date())

    expect(export_.user).toBeNull()
    expect(export_.client).toBeNull()
    expect(export_.photos).toEqual([])
    expect(export_.posts).toEqual([])
  })

  it("returns client null when the user exists but has no client row (admin user)", async () => {
    await db.insert(users).values({
      id: "admin-user-1",
      email: "admin@example.com",
      role: "admin",
    })

    const export_ = await buildExportJson(db, "admin-user-1", new Date())

    expect(export_.user).not.toBeNull()
    expect(export_.client).toBeNull()
    expect(export_.photos).toEqual([])
    expect(export_.posts).toEqual([])
  })
})
