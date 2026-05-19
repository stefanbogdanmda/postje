import { describe, it, expect, beforeEach, vi } from "vitest"
import { publishToFacebook, publishToInstagram } from "../publish"

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
