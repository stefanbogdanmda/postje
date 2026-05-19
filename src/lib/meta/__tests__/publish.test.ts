import { describe, it, expect, beforeEach, vi } from "vitest"
import { publishToFacebook } from "../publish"

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
