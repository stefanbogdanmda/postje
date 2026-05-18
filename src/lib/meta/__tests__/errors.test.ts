import { describe, it, expect } from "vitest"
import { classifyMetaError } from "../errors"

describe("classifyMetaError", () => {
  it("classifies 5xx HTTP status as transient", () => {
    const result = classifyMetaError({ httpStatus: 503, body: null })
    expect(result.class).toBe("transient")
  })

  it("classifies 429 as transient", () => {
    const result = classifyMetaError({ httpStatus: 429, body: null })
    expect(result.class).toBe("transient")
  })

  it("classifies network timeout (no httpStatus) as transient", () => {
    const result = classifyMetaError({ httpStatus: null, body: null })
    expect(result.class).toBe("transient")
  })

  it("classifies OAuthException code 190 as token-expired", () => {
    const result = classifyMetaError({
      httpStatus: 400,
      body: { error: { code: 190, type: "OAuthException", message: "Token expired" } },
    })
    expect(result.class).toBe("token-expired")
    expect(result.code).toBe("190")
    expect(result.message).toBe("Token expired")
  })

  it("classifies 4xx with non-auth error code as content-rejected", () => {
    const result = classifyMetaError({
      httpStatus: 400,
      body: { error: { code: 100, message: "Invalid parameter" } },
    })
    expect(result.class).toBe("content-rejected")
    expect(result.code).toBe("100")
  })

  it("classifies missing error body on 4xx as content-rejected", () => {
    const result = classifyMetaError({ httpStatus: 400, body: null })
    expect(result.class).toBe("content-rejected")
    expect(result.message).toBe("HTTP 400")
  })
})
