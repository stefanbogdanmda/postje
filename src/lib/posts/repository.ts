import { eq, and, gte, lte, lt, inArray, isNull, sql } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import * as schema from "@/db/schema"
import type { Post, LockedDay } from "./types"
import {
  DEFAULT_POST_TIME,
  INDUSTRY_POST_TIMES,
  type Platform,
  type PostStatus,
} from "./config"

type Db = BetterSQLite3Database<typeof schema>

/** Statuses that block deletion during regeneration. */
const LOCKED_STATUSES: PostStatus[] = ["approved", "published", "failed"]

/** Statuses that get deleted during regeneration. */
const REPLACEABLE_STATUSES: PostStatus[] = ["draft", "rejected"]

const postSelect = {
  id: schema.posts.id,
  clientId: schema.posts.clientId,
  platform: schema.posts.platform,
  scheduledDate: schema.posts.scheduledDate,
  status: schema.posts.status,
  content: schema.posts.content,
  photoId: schema.posts.photoId,
  photoUrl: schema.photos.blobUrl,
  reasoning: schema.posts.reasoning,
  publishAt: schema.posts.publishAt,
  rejectionCount: schema.posts.rejectionCount,
  approvedAt: schema.posts.approvedAt,
  rejectedAt: schema.posts.rejectedAt,
  publishedAt: schema.posts.publishedAt,
  publishError: schema.posts.publishError,
  firstSeenAt: schema.posts.firstSeenAt,
  alertedAt: schema.posts.alertedAt,
  createdAt: schema.posts.createdAt,
  updatedAt: schema.posts.updatedAt,
}

function assertChanged(
  result: unknown,
  notFoundMessage: string,
  staleMessage: string
): void {
  const changes =
    typeof result === "object" && result !== null && "changes" in result
      ? Number((result as { changes: unknown }).changes)
      : 0

  if (changes === 0) {
    throw new Error(`${notFoundMessage}. ${staleMessage}`)
  }
}

function getClientPostTime(db: Db, clientId: string): string {
  const client = db
    .select({ industry: schema.clients.industry })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .get()

  const industry = client?.industry?.toLowerCase().trim()
  if (!industry) return DEFAULT_POST_TIME

  const exactMatch = INDUSTRY_POST_TIMES[industry]
  if (exactMatch) return exactMatch

  const partialMatch = Object.entries(INDUSTRY_POST_TIMES).find(([key]) =>
    industry.includes(key)
  )

  return partialMatch?.[1] ?? DEFAULT_POST_TIME
}

function buildPublishAt(scheduledDate: string, postTime: string): Date {
  const [year, month, day] = scheduledDate.split("-").map(Number)
  const [hour, minute] = postTime.split(":").map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

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
    .select(postSelect)
    .from(schema.posts)
    .leftJoin(schema.photos, eq(schema.posts.photoId, schema.photos.id))
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

/**
 * Find a single post by ID, scoped to the given client.
 * Returns null if no matching post exists.
 */
export function getPostById(
  db: Db,
  postId: string,
  clientId: string
): Post | null {
  const row = db
    .select(postSelect)
    .from(schema.posts)
    .leftJoin(schema.photos, eq(schema.posts.photoId, schema.photos.id))
    .where(
      and(
        eq(schema.posts.id, postId),
        eq(schema.posts.clientId, clientId)
      )
    )
    .get()

  return (row as Post) ?? null
}

/**
 * Approve a draft post. Optionally updates the content (e.g. after
 * client edits). Throws if the post is not found or not in draft status.
 */
export function approvePost(
  db: Db,
  postId: string,
  clientId: string,
  newContent?: string
): Post {
  const post = getPostById(db, postId, clientId)

  if (!post) {
    throw new Error(`Post not found: ${postId}`)
  }
  if (post.status !== "draft") {
    throw new Error(`Cannot approve post with status "${post.status}"`)
  }

  const now = new Date()
  const postTime = getClientPostTime(db, clientId)
  const updates: Record<string, unknown> = {
    status: "approved",
    approvedAt: now,
    publishAt: buildPublishAt(post.scheduledDate, postTime),
    updatedAt: now,
  }
  if (newContent !== undefined) {
    updates.content = newContent
  }

  const result = db.update(schema.posts)
    .set(updates)
    .where(
      and(
        eq(schema.posts.id, postId),
        eq(schema.posts.clientId, clientId),
        eq(schema.posts.status, "draft")
      )
    )
    .run()

  assertChanged(
    result,
    `Post not found: ${postId}`,
    "Cannot approve post because it is no longer a draft"
  )

  return getPostById(db, postId, clientId) as Post
}

/**
 * Reject a draft post. Sets status to "rejected", records the
 * timestamp, and increments the rejection count.
 * Throws if the post is not found or not in draft status.
 */
export function rejectPost(
  db: Db,
  postId: string,
  clientId: string
): Post {
  const post = getPostById(db, postId, clientId)

  if (!post) {
    throw new Error(`Post not found: ${postId}`)
  }
  if (post.status !== "draft") {
    throw new Error(`Cannot reject post with status "${post.status}"`)
  }

  const now = new Date()

  const result = db.update(schema.posts)
    .set({
      status: "rejected",
      rejectedAt: now,
      rejectionCount: sql`${schema.posts.rejectionCount} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.posts.id, postId),
        eq(schema.posts.clientId, clientId),
        eq(schema.posts.status, "draft")
      )
    )
    .run()

  assertChanged(
    result,
    `Post not found: ${postId}`,
    "Cannot reject post because it is no longer a draft"
  )

  return getPostById(db, postId, clientId) as Post
}

/**
 * Replace a post's content and reasoning after regeneration.
 * Increments rejectionCount, resets status to "draft", and
 * updates the timestamp. Throws if the post is not found.
 */
export function regeneratePost(
  db: Db,
  postId: string,
  clientId: string,
  newContent: string,
  newReasoning: string
): Post {
  const post = getPostById(db, postId, clientId)

  if (!post) {
    throw new Error(`Post not found: ${postId}`)
  }
  if (post.status !== "draft") {
    throw new Error(`Cannot regenerate post with status "${post.status}"`)
  }

  const now = new Date()

  const result = db.update(schema.posts)
    .set({
      content: newContent,
      reasoning: newReasoning,
      status: "draft",
      rejectionCount: sql`${schema.posts.rejectionCount} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.posts.id, postId),
        eq(schema.posts.clientId, clientId),
        eq(schema.posts.status, "draft")
      )
    )
    .run()

  assertChanged(
    result,
    `Post not found: ${postId}`,
    "Cannot regenerate post because it is no longer a draft"
  )

  return getPostById(db, postId, clientId) as Post
}

/**
 * Stamp `firstSeenAt = now` on every post in `postIds` belonging to
 * `clientId` whose `firstSeenAt` is currently NULL. Posts that already
 * have a `firstSeenAt` are not overwritten. Posts owned by other clients
 * are silently skipped (tenant isolation).
 *
 * Safe to call on every dashboard load. Single UPDATE statement; SQLite
 * handles the IN clause natively.
 */
export function markPostsAsSeen(
  db: Db,
  postIds: string[],
  clientId: string,
  now: Date = new Date()
): void {
  if (postIds.length === 0) return

  db.update(schema.posts)
    .set({ firstSeenAt: now })
    .where(
      and(
        eq(schema.posts.clientId, clientId),
        inArray(schema.posts.id, postIds),
        isNull(schema.posts.firstSeenAt)
      )
    )
    .run()
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export interface StalePost {
  id: string
  clientId: string
  businessName: string
  platform: "instagram" | "facebook"
  scheduledDate: string
  content: string
  firstSeenAt: Date
}

/**
 * Find every draft post that:
 *   - has firstSeenAt set
 *   - was first seen more than 24 hours before `now`
 *   - has NOT yet been alerted
 *
 * Joins clients to include businessName for the email subject.
 */
export function findStalePosts(db: Db, now: Date): StalePost[] {
  const cutoff = new Date(now.getTime() - TWENTY_FOUR_HOURS_MS)

  const rows = db
    .select({
      id: schema.posts.id,
      clientId: schema.posts.clientId,
      businessName: schema.clients.businessName,
      platform: schema.posts.platform,
      scheduledDate: schema.posts.scheduledDate,
      content: schema.posts.content,
      firstSeenAt: schema.posts.firstSeenAt,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.posts.clientId, schema.clients.id))
    .where(
      and(
        eq(schema.posts.status, "draft"),
        lt(schema.posts.firstSeenAt, cutoff),
        isNull(schema.posts.alertedAt)
      )
    )
    .all()

  return rows as StalePost[]
}

/**
 * Mark a single post as alerted. Idempotent — running twice has no effect
 * because the WHERE clause requires alertedAt IS NULL.
 */
export function markPostAlerted(db: Db, postId: string, now: Date = new Date()): void {
  db.update(schema.posts)
    .set({ alertedAt: now })
    .where(
      and(
        eq(schema.posts.id, postId),
        isNull(schema.posts.alertedAt)
      )
    )
    .run()
}
