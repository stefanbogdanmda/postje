import { describe, it, expect, beforeEach, vi } from "vitest"
import { publishToFacebook, publishToInstagram, publishPostToMeta } from "../publish"
import { createTestDb, seedTestClient, seedTestPhoto, seedMetaConnection, type TestDb } from "@/test/db"
import { posts, publishAttempts } from "@/db/schema"
import { eq } from "drizzle-orm"

beforeEach(() => {
  process.env.META_GRAPH_VERSION = "v21.0"
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("publishToFacebook — with photo", () => {
  it("calls /PAGE_ID/photos with message + url and returns post_id", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST")
      expect(url).toBe("https://graph.facebook.com/v21.0/PAGE_1/photos")
      const body = init?.body as URLSearchParams
      expect(body.get("message")).toBe("Hello world")
      expect(body.get("url")).toBe("https://example.com/photo.jpg")
      expect(body.get("access_token")).toBe("PAGE_TOKEN")
      return jsonResponse({ id: "PHOTO_ID", post_id: "FEED_POST_ID" })
    })

    const id = await publishToFacebook(
      { pageId: "PAGE_1", accessToken: "PAGE_TOKEN" },
      { content: "Hello world", photoUrl: "https://example.com/photo.jpg" },
      fetcher
    )
    expect(id).toBe("FEED_POST_ID")
  })

  it("propagates graph errors as MetaApiError", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { message: "Invalid token", code: 190 } }, 400)
    )
    await expect(
      publishToFacebook(
        { pageId: "PAGE_1", accessToken: "BAD" },
        { content: "x", photoUrl: "https://example.com/photo.jpg" },
        fetcher
      )
    ).rejects.toThrow(/Invalid token/)
  })
})

describe("publishToFacebook — without photo", () => {
  it("calls /PAGE_ID/feed with message only and returns id", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://graph.facebook.com/v21.0/PAGE_1/feed")
      const body = init?.body as URLSearchParams
      expect(body.get("message")).toBe("Text-only post")
      expect(body.get("url")).toBeNull()
      return jsonResponse({ id: "FEED_ID" })
    })
    const id = await publishToFacebook(
      { pageId: "PAGE_1", accessToken: "PAGE_TOKEN" },
      { content: "Text-only post", photoUrl: null },
      fetcher
    )
    expect(id).toBe("FEED_ID")
  })
})

describe("publishToInstagram", () => {
  it("creates a media container then publishes it and returns the final id", async () => {
    let step = 0
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      step++
      const body = init?.body as URLSearchParams
      if (step === 1) {
        expect(url).toBe("https://graph.facebook.com/v21.0/IG_1/media")
        expect(body.get("image_url")).toBe("https://example.com/p.jpg")
        expect(body.get("caption")).toBe("Hello IG")
        expect(body.get("access_token")).toBe("PAGE_TOKEN")
        return jsonResponse({ id: "CONTAINER_123" })
      }
      if (step === 2) {
        expect(url).toBe("https://graph.facebook.com/v21.0/IG_1/media_publish")
        expect(body.get("creation_id")).toBe("CONTAINER_123")
        expect(body.get("access_token")).toBe("PAGE_TOKEN")
        return jsonResponse({ id: "IG_MEDIA_FINAL" })
      }
      throw new Error("unexpected extra fetch")
    })
    const id = await publishToInstagram(
      { igUserId: "IG_1", accessToken: "PAGE_TOKEN" },
      { content: "Hello IG", photoUrl: "https://example.com/p.jpg" },
      fetcher
    )
    expect(id).toBe("IG_MEDIA_FINAL")
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("throws a no-photo error without calling Meta when photoUrl is null", async () => {
    const fetcher = vi.fn()
    await expect(
      publishToInstagram(
        { igUserId: "IG_1", accessToken: "PAGE_TOKEN" },
        { content: "no image", photoUrl: null },
        fetcher
      )
    ).rejects.toThrow(/photo/i)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("propagates a container-step failure without calling step 2", async () => {
    let step = 0
    const fetcher = vi.fn(async () => {
      step++
      return jsonResponse({ error: { message: "image fetch failed", code: 324 } }, 400)
    })
    await expect(
      publishToInstagram(
        { igUserId: "IG_1", accessToken: "PAGE_TOKEN" },
        { content: "x", photoUrl: "https://example.com/p.jpg" },
        fetcher
      )
    ).rejects.toThrow(/image fetch failed/)
    expect(step).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────
// Orchestrator tests — real DB (PGlite), mocked HTTP
// ─────────────────────────────────────────────────────────

const CLIENT_ID = "test-client-001"
const ENC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

let db: TestDb

async function seedApprovedPost(opts: {
  platform: "instagram" | "facebook"
  withPhoto: boolean
  content?: string
}) {
  const photoId = opts.withPhoto ? "photo-1" : null
  if (photoId) await seedTestPhoto(db, CLIENT_ID, photoId)
  await db.insert(posts).values({
    clientId: CLIENT_ID,
    platform: opts.platform,
    scheduledDate: "2026-05-12",
    status: "approved",
    content: opts.content ?? "hello",
    reasoning: "test",
    photoId,
    publishAt: new Date(),
    approvedAt: new Date(),
  })
  const row = await db.select().from(posts).where(eq(posts.clientId, CLIENT_ID))
  return row[0]
}

describe("publishPostToMeta — orchestrator", () => {
  beforeEach(async () => {
    process.env.META_TOKEN_ENCRYPTION_KEY = ENC_KEY
    process.env.META_GRAPH_VERSION = "v21.0"
    db = await createTestDb()
    await seedTestClient(db, CLIENT_ID)
    await seedMetaConnection(db, CLIENT_ID, {
      accessTokenPlaintext: "PAGE_TOKEN_PLAINTEXT",
    })
  })

  it("returns guard-failed when the post is not in 'approved' status", async () => {
    await db.insert(posts).values({
      clientId: CLIENT_ID,
      platform: "instagram",
      scheduledDate: "2026-05-12",
      status: "draft",
      content: "x",
      reasoning: "x",
    })
    const draft = (await db.select().from(posts))[0]
    const result = await publishPostToMeta(db, draft.id, "admin-1", vi.fn())
    expect(result.success).toBe(false)
    expect(result.guardFailure).toBe("not-approved")
    const attempts = await db.select().from(publishAttempts)
    expect(attempts).toHaveLength(0)
  })

  it("returns guard-failed when the post has no meta connection", async () => {
    const { metaConnections } = await import("@/db/schema")
    await db.delete(metaConnections)
    const post = await seedApprovedPost({ platform: "facebook", withPhoto: false })
    const result = await publishPostToMeta(db, post.id, "admin-1", vi.fn())
    expect(result.success).toBe(false)
    expect(result.guardFailure).toBe("no-connection")
  })

  it("publishes a Facebook text post and updates state on success", async () => {
    const post = await seedApprovedPost({ platform: "facebook", withPhoto: false })
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ id: "FB_FEED_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    )
    const result = await publishPostToMeta(db, post.id, "admin-1", fetcher)
    expect(result.success).toBe(true)
    expect(result.metaPostId).toBe("FB_FEED_1")
    const updated = (await db.select().from(posts).where(eq(posts.id, post.id)))[0]
    expect(updated.status).toBe("published")
    expect(updated.publishedAt).toBeInstanceOf(Date)
    expect(updated.publishError).toBeNull()
    const attempts = await db.select().from(publishAttempts).where(eq(publishAttempts.postId, post.id))
    expect(attempts).toHaveLength(1)
    expect(attempts[0].success).toBe(true)
    expect(attempts[0].metaPostId).toBe("FB_FEED_1")
    expect(attempts[0].attemptedBy).toBe("admin-1")
    expect(typeof attempts[0].requestDurationMs).toBe("number")
  })

  it("records a failure and flips status to 'failed' when Meta returns an error", async () => {
    const post = await seedApprovedPost({ platform: "facebook", withPhoto: false })
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: "Token expired", code: 190 } }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    )
    const result = await publishPostToMeta(db, post.id, "admin-1", fetcher)
    expect(result.success).toBe(false)
    expect(result.errorClass).toBe("permanent-token")
    expect(result.errorMessage).toMatch(/Token expired/)
    const updated = (await db.select().from(posts).where(eq(posts.id, post.id)))[0]
    expect(updated.status).toBe("failed")
    expect(updated.publishError).toMatch(/Token expired/)
    const attempts = await db.select().from(publishAttempts).where(eq(publishAttempts.postId, post.id))
    expect(attempts).toHaveLength(1)
    expect(attempts[0].success).toBe(false)
    expect(attempts[0].errorClass).toBe("permanent-token")
  })

  it("publishes an Instagram post via the two-step flow", async () => {
    const post = await seedApprovedPost({ platform: "instagram", withPhoto: true })
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "CONTAINER" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "IG_FINAL" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    const result = await publishPostToMeta(db, post.id, "admin-1", fetcher)
    expect(result.success).toBe(true)
    expect(result.metaPostId).toBe("IG_FINAL")
  })
})
