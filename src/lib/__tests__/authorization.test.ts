import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}))

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(),
  },
}))

import {
  requireUser,
  requireAdmin,
  requireClientAccess,
  toErrorResponse,
  HttpError,
} from "../authorization"
import { auth } from "@/lib/auth"
import { db } from "@/db"

const mockedAuth = vi.mocked(auth)

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Helpers ──

function adminSession() {
  return { user: { id: "admin-1", role: "admin" } } as never
}

function clientSession(userId = "user-1") {
  return { user: { id: userId, role: "client" } } as never
}

function noSession() {
  return null as never
}

function sessionWithoutUser() {
  return {} as never
}

function sessionWithBadRole() {
  return { user: { id: "user-1", role: "viewer" } } as never
}

function mockDbSelectReturning(rows: Array<Record<string, unknown>>) {
  vi.mocked(db.select).mockReturnValue({
    from: () => ({ where: () => ({ limit: async () => rows }) }),
  } as never)
}

// ── requireUser ──

describe("requireUser", () => {
  it("returns user when session has valid admin role", async () => {
    mockedAuth.mockResolvedValue(adminSession())

    const user = await requireUser()

    expect(user).toEqual({ id: "admin-1", role: "admin" })
  })

  it("returns user when session has valid client role", async () => {
    mockedAuth.mockResolvedValue(clientSession())

    const user = await requireUser()

    expect(user).toEqual({ id: "user-1", role: "client" })
  })

  it("throws 401 when session is null", async () => {
    mockedAuth.mockResolvedValue(noSession())

    await expect(requireUser()).rejects.toThrow(HttpError)
    await expect(requireUser()).rejects.toThrow("Unauthorized")
  })

  it("throws 401 when session has no user", async () => {
    mockedAuth.mockResolvedValue(sessionWithoutUser())

    await expect(requireUser()).rejects.toThrow(HttpError)
  })

  it("throws 401 when user has no id", async () => {
    mockedAuth.mockResolvedValue({ user: { role: "admin" } } as never)

    await expect(requireUser()).rejects.toThrow(HttpError)
  })

  it("throws 401 when user has invalid role", async () => {
    mockedAuth.mockResolvedValue(sessionWithBadRole())

    await expect(requireUser()).rejects.toThrow(HttpError)
  })

  it("HttpError has status 401", async () => {
    mockedAuth.mockResolvedValue(noSession())

    try {
      await requireUser()
      expect.fail("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
      expect((error as HttpError).status).toBe(401)
    }
  })
})

// ── requireAdmin ──

describe("requireAdmin", () => {
  it("returns admin user when role is admin", async () => {
    mockedAuth.mockResolvedValue(adminSession())

    const user = await requireAdmin()

    expect(user).toEqual({ id: "admin-1", role: "admin" })
  })

  it("throws 403 when role is client", async () => {
    mockedAuth.mockResolvedValue(clientSession())

    try {
      await requireAdmin()
      expect.fail("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
      expect((error as HttpError).status).toBe(403)
      expect((error as HttpError).message).toBe("Forbidden")
    }
  })

  it("throws 401 when no session (delegates to requireUser)", async () => {
    mockedAuth.mockResolvedValue(noSession())

    try {
      await requireAdmin()
      expect.fail("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
      expect((error as HttpError).status).toBe(401)
    }
  })
})

// ── requireClientAccess ──

describe("requireClientAccess", () => {
  describe("admin role", () => {
    it("returns clientId when admin provides valid clientId", async () => {
      mockedAuth.mockResolvedValue(adminSession())
      mockDbSelectReturning([{ id: "client-abc" }])

      const result = await requireClientAccess("client-abc")

      expect(result.user).toEqual({ id: "admin-1", role: "admin" })
      expect(result.clientId).toBe("client-abc")
    })

    it("throws 400 when admin provides null clientId", async () => {
      mockedAuth.mockResolvedValue(adminSession())

      try {
        await requireClientAccess(null)
        expect.fail("should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError)
        expect((error as HttpError).status).toBe(400)
        expect((error as HttpError).message).toBe("clientId is required")
      }
    })

    it("throws 400 when admin provides undefined clientId", async () => {
      mockedAuth.mockResolvedValue(adminSession())

      try {
        await requireClientAccess(undefined)
        expect.fail("should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError)
        expect((error as HttpError).status).toBe(400)
      }
    })

    it("throws 404 when admin provides unknown clientId", async () => {
      mockedAuth.mockResolvedValue(adminSession())
      mockDbSelectReturning([])

      try {
        await requireClientAccess("unknown-client")
        expect.fail("should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError)
        expect((error as HttpError).status).toBe(404)
        expect((error as HttpError).message).toBe("Client not found")
      }
    })
  })

  describe("client role", () => {
    it("returns clientId for client accessing own data", async () => {
      mockedAuth.mockResolvedValue(clientSession("user-1"))
      mockDbSelectReturning([{ id: "client-owned" }])

      const result = await requireClientAccess(null)

      expect(result.user).toEqual({ id: "user-1", role: "client" })
      expect(result.clientId).toBe("client-owned")
    })

    it("returns clientId when client provides matching clientId", async () => {
      mockedAuth.mockResolvedValue(clientSession("user-1"))
      mockDbSelectReturning([{ id: "client-owned" }])

      const result = await requireClientAccess("client-owned")

      expect(result.clientId).toBe("client-owned")
    })

    it("throws 403 when client tries to access another client", async () => {
      mockedAuth.mockResolvedValue(clientSession("user-1"))
      mockDbSelectReturning([{ id: "client-owned" }])

      try {
        await requireClientAccess("different-client")
        expect.fail("should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError)
        expect((error as HttpError).status).toBe(403)
      }
    })

    it("throws 403 when user has no client record", async () => {
      mockedAuth.mockResolvedValue(clientSession("user-no-client"))
      mockDbSelectReturning([])

      try {
        await requireClientAccess(null)
        expect.fail("should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError)
        expect((error as HttpError).status).toBe(403)
      }
    })
  })

  it("throws 401 when no session", async () => {
    mockedAuth.mockResolvedValue(noSession())

    try {
      await requireClientAccess("any-client")
      expect.fail("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
      expect((error as HttpError).status).toBe(401)
    }
  })
})

// ── toErrorResponse ──

describe("toErrorResponse", () => {
  it("returns correct status for HttpError", async () => {
    const error = new HttpError(403, "Forbidden")

    const response = toErrorResponse(error)

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body).toEqual({ error: "Forbidden" })
  })

  it("returns 401 for HttpError with status 401", async () => {
    const error = new HttpError(401, "Unauthorized")

    const response = toErrorResponse(error)

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body).toEqual({ error: "Unauthorized" })
  })

  it("returns 404 for HttpError with status 404", async () => {
    const error = new HttpError(404, "Client not found")

    const response = toErrorResponse(error)

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body).toEqual({ error: "Client not found" })
  })

  it("returns 500 for non-HttpError", async () => {
    const error = new Error("something went wrong")

    const response = toErrorResponse(error)

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ error: "Internal server error" })
  })

  it("returns 500 for string errors", async () => {
    const response = toErrorResponse("unexpected string error")

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ error: "Internal server error" })
  })

  it("does not leak internal error details for non-HttpError", async () => {
    const error = new Error("database connection lost: postgres://user:password@host")

    const response = toErrorResponse(error)
    const body = await response.json()

    expect(body.error).toBe("Internal server error")
    expect(JSON.stringify(body)).not.toContain("database")
    expect(JSON.stringify(body)).not.toContain("password")
  })
})

// ── HttpError class ──

describe("HttpError", () => {
  it("is an instance of Error", () => {
    const error = new HttpError(400, "Bad request")
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(HttpError)
  })

  it("has correct status and message properties", () => {
    const error = new HttpError(422, "Validation failed")
    expect(error.status).toBe(422)
    expect(error.message).toBe("Validation failed")
  })
})
