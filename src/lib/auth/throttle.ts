import { eq, and, lt, sql } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"

/** Any Postgres-dialect Drizzle database (Neon in prod, PGlite in tests). */
type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export const MAGIC_LINK_MAX_REQUESTS = 5
export const MAGIC_LINK_WINDOW_MS = 15 * 60 * 1000

const SERIALIZATION_FAILURE_CODE = "40001"

export interface ThrottleDeps {
  db: Db
  now?: Date
}

export interface RateLimitOptions {
  maxRequests: number
  windowMs: number
}

/**
 * Magic-link throttle. Returns true when the request should be blocked.
 *
 * The key is the lowercased email. At most MAGIC_LINK_MAX_REQUESTS requests
 * are allowed per MAGIC_LINK_WINDOW_MS. When the limit is reached, the
 * function does NOT record the over-limit attempt — so a hammered key stays
 * at exactly MAX_REQUESTS rows in the table.
 */
export async function isMagicLinkRateLimited(
  email: string,
  deps: ThrottleDeps
): Promise<boolean> {
  return isKeyRateLimited(
    email.toLowerCase(),
    { maxRequests: MAGIC_LINK_MAX_REQUESTS, windowMs: MAGIC_LINK_WINDOW_MS },
    deps
  )
}

/**
 * Generic per-key rate limiter sharing the same storage. The caller chooses
 * its own window + maximum. Returns true when the request should be blocked.
 */
export async function isKeyRateLimited(
  key: string,
  options: RateLimitOptions,
  deps: ThrottleDeps
): Promise<boolean> {
  const now = deps.now ?? new Date()
  const windowStart = new Date(now.getTime() - options.windowMs)

  return runWithSerializableRetry(deps.db, async (tx) => {
    await tx
      .delete(schema.authThrottle)
      .where(
        and(
          eq(schema.authThrottle.key, key),
          lt(schema.authThrottle.requestedAt, windowStart)
        )
      )

    const countRows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.authThrottle)
      .where(eq(schema.authThrottle.key, key))

    const current = countRows[0]?.count ?? 0

    if (current >= options.maxRequests) {
      return true
    }

    await tx.insert(schema.authThrottle).values({
      key,
      requestedAt: now,
    })

    return false
  })
}

/**
 * Run `fn` inside a SERIALIZABLE transaction. If it aborts with a serialization
 * failure (Postgres error 40001), retry once. If the retry also fails, fail
 * closed by reporting "rate-limited" to the caller — never let throttle bugs
 * accidentally open the gate.
 */
async function runWithSerializableRetry(
  db: Db,
  fn: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<boolean>
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await db.transaction(fn, { isolationLevel: "serializable" })
    } catch (error: unknown) {
      if (!isSerializationFailure(error)) {
        throw error
      }
    }
  }

  return true
}

function isSerializationFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const code = (error as { code?: unknown }).code
  return code === SERIALIZATION_FAILURE_CODE
}
