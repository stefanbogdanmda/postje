import { describe, it, expect } from "vitest"
import { metaFetch } from "../graph-client"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("metaFetch", () => {
  it("returns ok=true with parsed body on 2xx", async () => {
    const fetcher = async () => jsonResponse(200, { id: "POST_123" })
    const result = await metaFetch("https://graph.facebook.com/v21.0/me", {}, fetcher)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.body).toEqual({ id: "POST_123" })
    }
  })

  it("returns ok=false with httpStatus and body on 4xx", async () => {
    const fetcher = async () =>
      jsonResponse(400, { error: { code: 100, message: "bad" } })
    const result = await metaFetch("https://example", {}, fetcher)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.httpStatus).toBe(400)
      expect(result.body).toEqual({ error: { code: 100, message: "bad" } })
    }
  })

  it("returns ok=false with httpStatus=null on network failure", async () => {
    const fetcher = async () => {
      throw new TypeError("fetch failed")
    }
    const result = await metaFetch("https://example", {}, fetcher)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.httpStatus).toBeNull()
    }
  })

  it("records durationMs in the result", async () => {
    const fetcher = async () => jsonResponse(200, {})
    const result = await metaFetch("https://example", {}, fetcher)
    expect(typeof result.durationMs).toBe("number")
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("passes through method and body to the fetcher", async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const fetcher = async (url: string, init?: RequestInit) => {
      captured = { url, init: init ?? {} }
      return jsonResponse(200, {})
    }
    await metaFetch(
      "https://example",
      { method: "POST", body: "x=1" },
      fetcher
    )
    expect(captured).not.toBeNull()
    expect(captured!.url).toBe("https://example")
    expect(captured!.init.method).toBe("POST")
    expect(captured!.init.body).toBe("x=1")
  })
})
