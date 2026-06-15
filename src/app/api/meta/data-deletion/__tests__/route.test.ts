import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

// The route imports `db` and the rate limiter; stub both so we can test the
// rate-limit wiring in isolation (the limiter itself is covered by throttle tests).
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/request-rate-limit", () => ({ rateLimitRequest: vi.fn() }))

import { POST } from "../route"
import { rateLimitRequest } from "@/lib/request-rate-limit"

const mockedRL = vi.mocked(rateLimitRequest)

beforeEach(() => {
  vi.clearAllMocks()
})

const post = (body?: BodyInit) =>
  POST(
    new Request("https://app.test/api/meta/data-deletion", {
      method: "POST",
      body,
    }) as never
  )

describe("data-deletion callback — rate limiting", () => {
  it("short-circuits with 429 when the limiter trips", async () => {
    mockedRL.mockResolvedValue(
      NextResponse.json({ error: "Too many requests." }, { status: 429 })
    )
    const res = await post(new FormData())
    expect(res.status).toBe(429)
  })

  it("proceeds past the limiter for an allowed request (then 400 on missing signed_request)", async () => {
    mockedRL.mockResolvedValue(null)
    const res = await post(new FormData())
    expect(mockedRL).toHaveBeenCalledWith(
      expect.anything(),
      "meta-data-deletion",
      30,
      60_000
    )
    expect(res.status).toBe(400) // no signed_request in the body
  })
})
