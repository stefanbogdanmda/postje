import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, seedTestClient, seedTestPhoto, type TestDb } from "@/test/db"
import { upsertConnection } from "../repository"
import { encryptToken } from "../crypto"
import { publishPostToMeta } from "../publish"
import * as schema from "@/db/schema"
import type { Fetcher } from "../graph-client"

const CLIENT_ID = "test-client-001"
const ORIGINAL_KEY = process.env.META_TOKEN_ENCRYPTION_KEY

let db: TestDb

beforeEach(async () => {
  process.env.META_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
  db = await createTestDb()
  await seedTestClient(db, CLIENT_ID)
  await upsertConnection(db, {
    clientId: CLIENT_ID,
    pageId: "PAGE_1",
    pageName: "Café Test",
    instagramBusinessId: "IG_1",
    encryptedAccessToken: encryptToken("test-token"),
    grantedScopes: "pages_manage_posts,instagram_content_publish",
  })
})

afterAll(() => {
  process.env.META_TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

async function seedApprovedPost(args: {
  id: string
  platform: "facebook" | "instagram"
  photoId?: string | null
  content?: string
}) {
  await db.insert(schema.posts).values({
    id: args.id,
    clientId: CLIENT_ID,
    platform: args.platform,
    scheduledDate: "2026-05-20",
    status: "approved",
    content: args.content ?? "Hello world",
    photoId: args.photoId ?? null,
    reasoning: "test",
  })
}

describe("publishPostToMeta — Facebook path", () => {
  it("publishes a text-only Facebook post via /feed", async () => {
    await seedApprovedPost({ id: "post-fb-1", platform: "facebook" })

    let capturedUrl = ""
    const fetcher: Fetcher = async (url) => {
      capturedUrl = url
      return jsonResponse(200, { id: "PAGE_1_999" })
    }

    const result = await publishPostToMeta(
      db,
      "post-fb-1",
      { fetcher, now: new Date() },
      "user-admin"
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.metaPostId).toBe("PAGE_1_999")
    }
    expect(capturedUrl).toContain("/PAGE_1/feed")

    const [post] = await db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.id, "post-fb-1"))
    expect(post.status).toBe("published")
    expect(post.publishedAt).not.toBeNull()
    expect(post.publishError).toBeNull()

    const attempts = await db.select().from(schema.publishAttempts)
    expect(attempts).toHaveLength(1)
    expect(attempts[0].success).toBe(true)
  })

  it("publishes a photo Facebook post via /photos with url + message", async () => {
    await seedTestPhoto(db, CLIENT_ID, "photo-1")
    await seedApprovedPost({ id: "post-fb-2", platform: "facebook", photoId: "photo-1" })

    let captured: { url: string; body: string } = { url: "", body: "" }
    const fetcher: Fetcher = async (url, init) => {
      captured = { url, body: String(init?.body ?? "") }
      return jsonResponse(200, { id: "PAGE_1_888" })
    }

    const result = await publishPostToMeta(
      db,
      "post-fb-2",
      { fetcher, now: new Date() },
      "user-admin"
    )

    expect(result.ok).toBe(true)
    expect(captured.url).toContain("/PAGE_1/photos")
    expect(captured.body).toContain("url=https")
    expect(captured.body).toContain("photo-1.jpg")
  })

  it("marks status=failed and writes error on permanent content rejection", async () => {
    await seedApprovedPost({ id: "post-fb-3", platform: "facebook" })

    const fetcher: Fetcher = async () =>
      jsonResponse(400, { error: { code: 100, message: "Invalid parameter" } })

    const result = await publishPostToMeta(
      db,
      "post-fb-3",
      { fetcher, now: new Date() },
      "user-admin"
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorClass).toBe("content-rejected")
      expect(result.errorMessage).toContain("Invalid parameter")
    }

    const [post] = await db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.id, "post-fb-3"))
    expect(post.status).toBe("failed")
    expect(post.publishError).toContain("Invalid parameter")
    expect(post.publishedAt).toBeNull()
  })

  it("marks status=failed but does not lose publish error on token expiry", async () => {
    await seedApprovedPost({ id: "post-fb-4", platform: "facebook" })

    const fetcher: Fetcher = async () =>
      jsonResponse(400, {
        error: { code: 190, type: "OAuthException", message: "Token expired" },
      })

    const result = await publishPostToMeta(
      db,
      "post-fb-4",
      { fetcher, now: new Date() },
      "user-admin"
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorClass).toBe("token-expired")
    }

    const [post] = await db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.id, "post-fb-4"))
    expect(post.status).toBe("failed")
    expect(post.publishError).toContain("Token expired")
  })

  it("returns an error when the client has no Meta connection", async () => {
    const otherClient = "test-client-002"
    await seedTestClient(db, otherClient)
    await db.insert(schema.posts).values({
      id: "post-orphan",
      clientId: otherClient,
      platform: "facebook",
      scheduledDate: "2026-05-20",
      status: "approved",
      content: "Hi",
      reasoning: "test",
    })

    const fetcher: Fetcher = async () => jsonResponse(200, { id: "x" })
    const result = await publishPostToMeta(
      db,
      "post-orphan",
      { fetcher, now: new Date() },
      "user-admin"
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toMatch(/no.*meta.*connection/i)
    }
    const [post] = await db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.id, "post-orphan"))
    expect(post.status).toBe("approved")
  })

  it("returns an error when the post is not in 'approved' status", async () => {
    await db.insert(schema.posts).values({
      id: "post-draft",
      clientId: CLIENT_ID,
      platform: "facebook",
      scheduledDate: "2026-05-20",
      status: "draft",
      content: "Hi",
      reasoning: "test",
    })

    const fetcher: Fetcher = async () => jsonResponse(200, { id: "x" })
    const result = await publishPostToMeta(
      db,
      "post-draft",
      { fetcher, now: new Date() },
      "user-admin"
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toMatch(/not approved/i)
    }
  })
})
