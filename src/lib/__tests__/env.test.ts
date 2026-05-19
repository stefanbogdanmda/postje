import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { validateEnv, assertEnv, getOptionalEnv, getEnvStatus } from "../env"

const REQUIRED_KEYS = [
  "DATABASE_URL",
  "AUTH_RESEND_KEY",
  "AUTH_SECRET",
  "CRON_SECRET",
  "ANTHROPIC_API_KEY",
]

const OPTIONAL_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "EMAIL_FROM",
  "ADMIN_EMAIL",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_OAUTH_REDIRECT_URI",
  "META_TOKEN_ENCRYPTION_KEY",
  "META_GRAPH_VERSION",
  "BLOB_READ_WRITE_TOKEN",
]

let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = {}
  for (const key of [...REQUIRED_KEYS, ...OPTIONAL_KEYS]) {
    savedEnv[key] = process.env[key]
  }
})

afterEach(() => {
  for (const key of [...REQUIRED_KEYS, ...OPTIONAL_KEYS]) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }
})

function setAllRequired() {
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test"
  process.env.AUTH_RESEND_KEY = "re_test_key"
  process.env.AUTH_SECRET = "test-secret"
  process.env.CRON_SECRET = "cron-secret"
  process.env.ANTHROPIC_API_KEY = "sk-ant-test"
}

function clearAllRequired() {
  for (const key of REQUIRED_KEYS) {
    delete process.env[key]
  }
}

describe("validateEnv", () => {
  it("returns empty array when all required vars are set", () => {
    setAllRequired()
    const missing = validateEnv()
    expect(missing).toHaveLength(0)
  })

  it("returns missing vars when some are not set", () => {
    clearAllRequired()
    const missing = validateEnv()
    expect(missing).toHaveLength(REQUIRED_KEYS.length)
    expect(missing.map((m) => m.key)).toEqual(REQUIRED_KEYS)
  })

  it("detects a single missing var", () => {
    setAllRequired()
    delete process.env.CRON_SECRET
    const missing = validateEnv()
    expect(missing).toHaveLength(1)
    expect(missing[0].key).toBe("CRON_SECRET")
  })

  it("treats empty string as missing", () => {
    setAllRequired()
    process.env.DATABASE_URL = ""
    const missing = validateEnv()
    expect(missing).toHaveLength(1)
    expect(missing[0].key).toBe("DATABASE_URL")
  })

  it("treats whitespace-only string as missing", () => {
    setAllRequired()
    process.env.AUTH_SECRET = "   "
    const missing = validateEnv()
    expect(missing).toHaveLength(1)
    expect(missing[0].key).toBe("AUTH_SECRET")
  })

  it("does not flag optional vars as missing", () => {
    setAllRequired()
    for (const key of OPTIONAL_KEYS) {
      delete process.env[key]
    }
    const missing = validateEnv()
    expect(missing).toHaveLength(0)
  })
})

describe("assertEnv", () => {
  it("does not throw when all required vars are set", () => {
    setAllRequired()
    expect(() => assertEnv()).not.toThrow()
  })

  it("throws with details when required vars are missing", () => {
    clearAllRequired()
    expect(() => assertEnv()).toThrow("Missing required environment variables")
    expect(() => assertEnv()).toThrow("DATABASE_URL")
    expect(() => assertEnv()).toThrow("AUTH_RESEND_KEY")
  })

  it("includes helpful setup instructions in error message", () => {
    clearAllRequired()
    try {
      assertEnv()
    } catch (error: unknown) {
      const message = (error as Error).message
      expect(message).toContain(".env.local")
      expect(message).toContain("Vercel")
    }
  })
})

describe("getOptionalEnv", () => {
  it("returns the env value when set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://my-app.vercel.app"
    expect(getOptionalEnv("NEXT_PUBLIC_APP_URL")).toBe("https://my-app.vercel.app")
  })

  it("returns fallback when env var is not set", () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(getOptionalEnv("NEXT_PUBLIC_APP_URL")).toBe("http://localhost:3000")
  })

  it("returns fallback when env var is empty", () => {
    process.env.EMAIL_FROM = ""
    expect(getOptionalEnv("EMAIL_FROM")).toBe("onboarding@resend.dev")
  })

  it("returns empty string for unknown keys", () => {
    expect(getOptionalEnv("UNKNOWN_VAR")).toBe("")
  })

  it("returns correct fallback for META_GRAPH_VERSION", () => {
    delete process.env.META_GRAPH_VERSION
    expect(getOptionalEnv("META_GRAPH_VERSION")).toBe("v21.0")
  })
})

describe("getEnvStatus", () => {
  it("returns status for all registered vars", () => {
    setAllRequired()
    const status = getEnvStatus()
    expect(status.length).toBe(REQUIRED_KEYS.length + OPTIONAL_KEYS.length)
  })

  it("marks required vars correctly", () => {
    setAllRequired()
    const status = getEnvStatus()
    const requiredEntries = status.filter((s) => s.required)
    expect(requiredEntries).toHaveLength(REQUIRED_KEYS.length)
    expect(requiredEntries.every((s) => s.present)).toBe(true)
  })

  it("marks missing vars as not present", () => {
    clearAllRequired()
    const status = getEnvStatus()
    const requiredEntries = status.filter((s) => s.required)
    expect(requiredEntries.every((s) => !s.present)).toBe(true)
  })

  it("does not expose actual values", () => {
    setAllRequired()
    const status = getEnvStatus()
    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain("re_test_key")
    expect(serialized).not.toContain("sk-ant-test")
  })
})
