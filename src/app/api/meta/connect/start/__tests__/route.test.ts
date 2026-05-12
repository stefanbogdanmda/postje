import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}))

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(),
  },
}))

import { GET } from "../route"
import { auth } from "@/lib/auth"
import { db } from "@/db"

const mockedAuth = vi.mocked(auth)

beforeEach(() => {
  process.env.META_APP_ID = "APP_ID_TEST"
  process.env.META_APP_SECRET = "APP_SECRET_TEST"
  process.env.META_OAUTH_REDIRECT_URI = "http://localhost:3000/api/meta/callback"
  process.env.AUTH_SECRET = "test-secret"
  vi.clearAllMocks()
})

function reqWith(clientId: string | null) {
  const u = new URL("http://localhost/api/meta/connect/start")
  if (clientId !== null) u.searchParams.set("clientId", clientId)
  return new Request(u)
}

function adminSession() {
  return { user: { id: "admin-1", role: "admin", email: "admin@example.com" } } as never
}

function clientSession() {
  return { user: { id: "client-1", role: "client", email: "client@example.com" } } as never
}

describe("GET /api/meta/connect/start", () => {
  it("returns 401 when no session", async () => {
    mockedAuth.mockResolvedValue(null as never)
    const res = await GET(reqWith("client-abc"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when caller is not admin", async () => {
    mockedAuth.mockResolvedValue(clientSession())
    const res = await GET(reqWith("client-abc"))
    expect(res.status).toBe(403)
  })

  it("returns 400 when clientId is missing", async () => {
    mockedAuth.mockResolvedValue(adminSession())
    const res = await GET(reqWith(null))
    expect(res.status).toBe(400)
  })

  it("returns 404 when the client does not exist", async () => {
    mockedAuth.mockResolvedValue(adminSession())
    vi.mocked(db.select).mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    } as never)
    const res = await GET(reqWith("unknown-client"))
    expect(res.status).toBe(404)
  })

  it("returns a meta dialog URL with state for a valid admin call", async () => {
    mockedAuth.mockResolvedValue(adminSession())
    vi.mocked(db.select).mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [{ id: "client-abc" }] }) }),
    } as never)
    const res = await GET(reqWith("client-abc"))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string }
    expect(body.url).toContain("https://www.facebook.com/")
    expect(body.url).toContain("dialog/oauth")
    expect(body.url).toMatch(/state=/)
  })
})
