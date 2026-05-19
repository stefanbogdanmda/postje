import { describe, it, expect } from "vitest"
import { readJsonOrThrow, MetaApiError } from "../client"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("readJsonOrThrow", () => {
  it("returns parsed JSON on a 2xx response", async () => {
    const res = jsonResponse({ ok: true, value: 42 })
    const body = (await readJsonOrThrow(res)) as { ok: boolean; value: number }
    expect(body).toEqual({ ok: true, value: 42 })
  })

  it("throws MetaApiError with the graph error message on a 4xx response", async () => {
    const res = jsonResponse(
      { error: { message: "Invalid OAuth access token", code: 190, error_subcode: 463 } },
      400
    )
    await expect(readJsonOrThrow(res)).rejects.toMatchObject({
      name: "MetaApiError",
      message: "Invalid OAuth access token",
      code: 190,
      subcode: 463,
      status: 400,
    })
  })

  it("throws MetaApiError on a 200 with non-JSON body", async () => {
    const res = new Response("not json at all", {
      status: 200,
      headers: { "content-type": "text/plain" },
    })
    await expect(readJsonOrThrow(res)).rejects.toThrow(/non-JSON/)
  })

  it("MetaApiError is an instance of Error", () => {
    const err = new MetaApiError("x", 500)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("MetaApiError")
  })
})
