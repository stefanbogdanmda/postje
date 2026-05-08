import { eq, and, gte, lte, inArray } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import * as schema from "@/db/schema"
import type { Post, LockedDay } from "./types"
import type { Platform, PostStatus } from "./config"

type Db = BetterSQLite3Database<typeof schema>

/** Statuses that block deletion during regeneration. */
const LOCKED_STATUSES: PostStatus[] = ["approved", "published", "failed"]

/** Statuses that get deleted during regeneration. */
const REPLACEABLE_STATUSES: PostStatus[] = ["draft", "rejected"]

/**
 * Insert post rows into the database. All rows are inserted in a
 * single transaction — either all succeed or none do.
 */
export function insertPosts(
  db: Db,
  rows: Array<{
    clientId: string
    platform: Platform
    scheduledDate: string
    status?: PostStatus
    content: string
    photoId?: string | null
    reasoning: string
    rejectionCount?: number
  }>
): void {
  const values = rows.map((row) => ({
    clientId: row.clientId,
    platform: row.platform,
    scheduledDate: row.scheduledDate,
    status: row.status ?? "draft",
    content: row.content,
    photoId: row.photoId ?? null,
    reasoning: row.reasoning,
    rejectionCount: row.rejectionCount ?? 0,
  }))

  db.transaction((tx) => {
    for (const value of values) {
      tx.insert(schema.posts).values(value).run()
    }
  })
}

/**
 * Query posts for a client within a date range (inclusive).
 * Returns rows ordered by scheduledDate, then platform.
 */
export function getPostsByDateRange(
  db: Db,
  clientId: string,
  startDate: string,
  endDate: string
): Post[] {
  return db
    .select()
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.clientId, clientId),
        gte(schema.posts.scheduledDate, startDate),
        lte(schema.posts.scheduledDate, endDate)
      )
    )
    .orderBy(schema.posts.scheduledDate, schema.posts.platform)
    .all() as Post[]
}

/**
 * Read rejection counts for rejected posts on specific dates.
 * Read-only — does not delete anything. Call this BEFORE the Claude
 * API call so counts are available even if generation fails.
 *
 * Returns a map keyed by "scheduledDate:platform".
 */
export function readRejectionCounts(
  db: Db,
  clientId: string,
  scheduledDates: string[]
): Map<string, number> {
  if (scheduledDates.length === 0) return new Map()

  const rejected = db
    .select({
      scheduledDate: schema.posts.scheduledDate,
      platform: schema.posts.platform,
      rejectionCount: schema.posts.rejectionCount,
    })
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.clientId, clientId),
        inArray(schema.posts.scheduledDate, scheduledDates),
        eq(schema.posts.status, "rejected")
      )
    )
    .all()

  const counts = new Map<string, number>()
  for (const row of rejected) {
    if (row.rejectionCount > 0) {
      counts.set(`${row.scheduledDate}:${row.platform}`, row.rejectionCount)
    }
  }
  return counts
}

/**
 * Atomically delete draft/rejected posts for specific dates and insert
 * new rows. Everything happens in one transaction — if insertion fails,
 * old posts are preserved.
 *
 * Approved, published, and failed posts are never deleted.
 */
export function replacePostsForOpenDays(
  db: Db,
  clientId: string,
  scheduledDates: string[],
  newRows: Array<{
    clientId: string
    platform: Platform
    scheduledDate: string
    status?: PostStatus
    content: string
    photoId?: string | null
    reasoning: string
    rejectionCount?: number
  }>
): void {
  db.transaction((tx) => {
    // Delete replaceable posts
    if (scheduledDates.length > 0) {
      tx.delete(schema.posts)
        .where(
          and(
            eq(schema.posts.clientId, clientId),
            inArray(schema.posts.scheduledDate, scheduledDates),
            inArray(schema.posts.status, REPLACEABLE_STATUSES)
          )
        )
        .run()
    }

    // Insert new rows
    for (const row of newRows) {
      tx.insert(schema.posts)
        .values({
          clientId: row.clientId,
          platform: row.platform,
          scheduledDate: row.scheduledDate,
          status: row.status ?? "draft",
          content: row.content,
          photoId: row.photoId ?? null,
          reasoning: row.reasoning,
          rejectionCount: row.rejectionCount ?? 0,
        })
        .run()
    }
  })
}

/**
 * Find days in a date range that have at least one locked post
 * (approved, published, or failed). These days cannot be regenerated.
 */
export function getLockedDays(
  db: Db,
  clientId: string,
  startDate: string,
  endDate: string
): LockedDay[] {
  const rows = db
    .select({
      scheduledDate: schema.posts.scheduledDate,
      photoId: schema.posts.photoId,
    })
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.clientId, clientId),
        gte(schema.posts.scheduledDate, startDate),
        lte(schema.posts.scheduledDate, endDate),
        inArray(schema.posts.status, LOCKED_STATUSES)
      )
    )
    .all()

  // Deduplicate by scheduledDate (multiple platform rows per day)
  const dayMap = new Map<string, boolean>()
  for (const row of rows) {
    const current = dayMap.get(row.scheduledDate) ?? false
    dayMap.set(row.scheduledDate, current || row.photoId !== null)
  }

  return Array.from(dayMap.entries()).map(([scheduledDate, hasPhoto]) => ({
    scheduledDate,
    hasPhoto,
  }))
}
