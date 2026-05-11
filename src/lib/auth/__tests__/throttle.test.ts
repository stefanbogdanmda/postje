import { describe, it, expect, beforeEach } from "vitest"
import { createTestDb, type TestDb } from "@/test/db"
import { authThrottle } from "@/db/schema"
import { eq } from "drizzle-orm"
import {
  isMagicLinkRateLimited,
  isKeyRateLimited,
  MAGIC_LINK_MAX_REQUESTS,
  MAGIC_LINK_WINDOW_MS,
} from "../throttle"

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
})

async function countRowsForKey(key: string): Promise<number> {
  const rows = await db
    .select({ id: authThrottle.id })
    .from(authThrottle)
    .where(eq(authThrottle.key, key))
  return rows.length
}

describe("isMagicLinkRateLimited — window semantics", () => {
  it("first request returns false and inserts a row", async () => {
    const now = new Date("2026-05-12T10:00:00Z")

    const limited = await isMagicLinkRateLimited("user@example.com", { db, now })

    expect(limited).toBe(false)
    expect(await countRowsForKey("user@example.com")).toBe(1)
  })

  it("returns false up to MAX_REQUESTS, true on the request after", async () => {
    const start = new Date("2026-05-12T10:00:00Z")

    for (let i = 0; i < MAGIC_LINK_MAX_REQUESTS; i++) {
      const now = new Date(start.getTime() + i * 1000)
      const limited = await isMagicLinkRateLimited("user@example.com", {
        db,
        now,
      })
      expect(limited).toBe(false)
    }

    const overLimit = await isMagicLinkRateLimited("user@example.com", {
      db,
      now: new Date(start.getTime() + MAGIC_LINK_MAX_REQUESTS * 1000),
    })

    expect(overLimit).toBe(true)
  })

  it("does NOT insert a row when rate-limited", async () => {
    const start = new Date("2026-05-12T10:00:00Z")

    for (let i = 0; i < MAGIC_LINK_MAX_REQUESTS; i++) {
      await isMagicLinkRateLimited("user@example.com", {
        db,
        now: new Date(start.getTime() + i * 1000),
      })
    }

    expect(await countRowsForKey("user@example.com")).toBe(
      MAGIC_LINK_MAX_REQUESTS
    )

    await isMagicLinkRateLimited("user@example.com", {
      db,
      now: new Date(start.getTime() + MAGIC_LINK_MAX_REQUESTS * 1000),
    })

    expect(await countRowsForKey("user@example.com")).toBe(
      MAGIC_LINK_MAX_REQUESTS
    )
  })

  it("treats rows older than the window as expired (does not count toward limit)", async () => {
    const start = new Date("2026-05-12T10:00:00Z")

    for (let i = 0; i < MAGIC_LINK_MAX_REQUESTS; i++) {
      await isMagicLinkRateLimited("user@example.com", {
        db,
        now: new Date(start.getTime() + i * 1000),
      })
    }

    const afterWindow = new Date(
      start.getTime() + MAGIC_LINK_WINDOW_MS + 1000
    )

    const limited = await isMagicLinkRateLimited("user@example.com", {
      db,
      now: afterWindow,
    })

    expect(limited).toBe(false)
  })

  it("deletes expired rows for the same key on the next call", async () => {
    const start = new Date("2026-05-12T10:00:00Z")

    for (let i = 0; i < MAGIC_LINK_MAX_REQUESTS; i++) {
      await isMagicLinkRateLimited("user@example.com", {
        db,
        now: new Date(start.getTime() + i * 1000),
      })
    }

    expect(await countRowsForKey("user@example.com")).toBe(
      MAGIC_LINK_MAX_REQUESTS
    )

    const afterWindow = new Date(
      start.getTime() + MAGIC_LINK_WINDOW_MS + 1000
    )

    await isMagicLinkRateLimited("user@example.com", {
      db,
      now: afterWindow,
    })

    // The 5 expired rows are gone, 1 fresh row remains.
    expect(await countRowsForKey("user@example.com")).toBe(1)
  })

  it("does NOT delete rows for other keys when cleaning up", async () => {
    const start = new Date("2026-05-12T10:00:00Z")

    await isMagicLinkRateLimited("alice@example.com", { db, now: start })
    await isMagicLinkRateLimited("bob@example.com", { db, now: start })

    const afterWindow = new Date(
      start.getTime() + MAGIC_LINK_WINDOW_MS + 1000
    )

    await isMagicLinkRateLimited("alice@example.com", {
      db,
      now: afterWindow,
    })

    // Alice's old row was cleaned, but Bob's stale row should remain — we
    // only clean per-key.
    expect(await countRowsForKey("bob@example.com")).toBe(1)
  })
})

describe("isMagicLinkRateLimited — case insensitivity", () => {
  it("treats 'Foo@Example.com' and 'foo@example.com' as the same counter", async () => {
    const start = new Date("2026-05-12T10:00:00Z")

    for (let i = 0; i < MAGIC_LINK_MAX_REQUESTS; i++) {
      await isMagicLinkRateLimited("Foo@Example.com", {
        db,
        now: new Date(start.getTime() + i * 1000),
      })
    }

    const limited = await isMagicLinkRateLimited("foo@example.com", {
      db,
      now: new Date(start.getTime() + MAGIC_LINK_MAX_REQUESTS * 1000),
    })

    expect(limited).toBe(true)
    expect(await countRowsForKey("foo@example.com")).toBe(
      MAGIC_LINK_MAX_REQUESTS
    )
  })
})

describe("isKeyRateLimited — generic helper", () => {
  it("enforces the provided maxRequests and windowMs independently", async () => {
    const start = new Date("2026-05-12T10:00:00Z")
    const options = { maxRequests: 3, windowMs: 60_000 }

    for (let i = 0; i < 3; i++) {
      const limited = await isKeyRateLimited("custom-key", options, {
        db,
        now: new Date(start.getTime() + i * 1000),
      })
      expect(limited).toBe(false)
    }

    const overLimit = await isKeyRateLimited("custom-key", options, {
      db,
      now: new Date(start.getTime() + 3 * 1000),
    })

    expect(overLimit).toBe(true)
  })

  it("does not share counters between distinct keys", async () => {
    const start = new Date("2026-05-12T10:00:00Z")
    const options = { maxRequests: 2, windowMs: 60_000 }

    await isKeyRateLimited("key-a", options, { db, now: start })
    await isKeyRateLimited("key-a", options, {
      db,
      now: new Date(start.getTime() + 1000),
    })

    const aLimited = await isKeyRateLimited("key-a", options, {
      db,
      now: new Date(start.getTime() + 2000),
    })
    const bLimited = await isKeyRateLimited("key-b", options, {
      db,
      now: new Date(start.getTime() + 2000),
    })

    expect(aLimited).toBe(true)
    expect(bLimited).toBe(false)
  })
})

describe("isMagicLinkRateLimited — defaults", () => {
  it("uses the current time when deps.now is omitted", async () => {
    const limited = await isMagicLinkRateLimited("user@example.com", { db })

    expect(limited).toBe(false)
    expect(await countRowsForKey("user@example.com")).toBe(1)
  })
})
