import { describe, it, expect } from "vitest"
import { classifyMetaError } from "../errors"

describe("classifyMetaError", () => {
  it("classifies 5xx as transient", () => {
    expect(classifyMetaError(undefined, undefined, 500)).toBe("transient")
    expect(classifyMetaError(undefined, undefined, 503)).toBe("transient")
  })

  it("classifies rate-limit codes as transient", () => {
    expect(classifyMetaError(4, undefined, 400)).toBe("transient")
    expect(classifyMetaError(17, undefined, 400)).toBe("transient")
    expect(classifyMetaError(32, undefined, 400)).toBe("transient")
    expect(classifyMetaError(613, undefined, 400)).toBe("transient")
  })

  it("classifies generic 'API unknown' (code 1, 2) as transient", () => {
    expect(classifyMetaError(1, undefined, 500)).toBe("transient")
    expect(classifyMetaError(2, undefined, 500)).toBe("transient")
  })

  it("classifies OAuthException (code 190) as permanent-token", () => {
    expect(classifyMetaError(190, undefined, 400)).toBe("permanent-token")
    expect(classifyMetaError(190, 463, 400)).toBe("permanent-token")
  })

  it("classifies permission errors (200) as permanent-token", () => {
    expect(classifyMetaError(200, undefined, 403)).toBe("permanent-token")
  })

  it("classifies IG content-policy code (36003) as permanent-content", () => {
    expect(classifyMetaError(36003, undefined, 400)).toBe("permanent-content")
  })

  it("classifies generic 400 with code 100 (invalid parameter) as permanent-content", () => {
    expect(classifyMetaError(100, undefined, 400)).toBe("permanent-content")
  })

  it("returns unknown when nothing matches", () => {
    expect(classifyMetaError(undefined, undefined, 400)).toBe("unknown")
    expect(classifyMetaError(99999, undefined, 400)).toBe("unknown")
  })
})
