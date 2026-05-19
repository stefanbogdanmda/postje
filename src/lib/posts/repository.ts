import { eq, and, gte, lte, lt, inArray, isNull, sql } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { Post, LockedDay } from "./types"
import {
  DEFAULT_POST_TIME,
  INDUSTRY_POST_TIMES,
  MAX_REJECTIONS,
  type Platform,
  type PostStatus,
} from "./config"

/**
 * Accept any Postgres-dialect Drizzle database. In production this is a
 * NeonDatabase; in tests it's a PgliteDatabase. Both extend PgDatabase.
 */
type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

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
  regenLimitAlertedAt: schema.posts.regenLimitAlertedAt,
  createdAt: schema.posts.createdAt,
  updatedAt: schema.posts.updatedAt,
}

function assertChanged(
  result: unknown,
  notFoundMessage: string,
  staleMessage: string
): void {
  // Postgres drivers differ on the property name for "rows changed":
  //   - node-postgres / Neon serverless → `rowCount` (number | null)
  //   - PGlite (used in tests)           → `affectedRows` (number | undefined)
  // We probe both defensively so this works across runtimes.
  if (typeof result !== "object" || result === null) {
    throw new Error(`${notFoundMessage}. ${staleMessage}`)
  }
  const r = result as { rowCount?: number | null; affectedRows?: number | null }
  const rowCount = Number(r.rowCount ?? r.affectedRows ?? 0)

  if (rowCount === 0) {
    throw new Error(`${notFoundMessage}. ${staleMessage}`)
  }
}

interface ClientScheduleInfo {
  postTime: string
  timezone: string
}

async function getClientScheduleInfo(
  db: Db,
  clientId: string
): Promise<ClientScheduleInfo> {
  const rows = await db
    .select({
      industry: schema.clients.industry,
      timezone: schema.clients.timezone,
    })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1)

  const industry = rows[0]?.industry?.toLowerCase().trim()
  const timezone = rows[0]?.timezone ?? "Europe/Amsterdam"

  let postTime = DEFAULT_POST_TIME
  if (industry) {
    const exactMatch = INDUSTRY_POST_TIMES[industry]
    if (exactMatch) {
      postTime = exactMatch
    } else {
      const partialMatch = Object.entries(INDUSTRY_POST_TIMES).find(([key]) =>
        industry.includes(key)
      )
      if (partialMatch) {
        postTime = partialMatch[1]
      }
    }
  }

  return { postTime, timezone }
}

/**
 * Build the exact UTC timestamp for when a post should be published,
 * given the client's local date, time, and IANA timezone.
 *
 * Without timezone handling, `new Date(year, month, day, hour, minute)`
 * uses the SERVER's local timezone (UTC on Vercel). That means a Dutch
 * client saying "post at 08:00" gets 08:00 UTC instead of 08:00
 * Amsterdam time — 1-2 hours too early depending on DST.
 *
 * This function uses the Intl API (built into Node.js / all modern
 * runtimes) to discover the timezone's UTC offset on the target date,
 * then subtracts it so the resulting Date is the correct UTC instant.
 */
export function buildPublishAt(
  scheduledDate: string,
  postTime: string,
  timezone: string
): Date {
  const tz = timezone || "Europe/Amsterdam"
  const [year, month, day] = scheduledDate.split("-").map(Number)
  const [hour, minute] = postTime.split(":").map(Number)

  // Treat the desired local time as if it were UTC
  const naiveUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))

  // Find what the timezone's offset is on this particular date.
  // We do this by formatting the same instant in both UTC and the
  // target timezone, then comparing the two.
  const utcStr = naiveUtc.toLocaleString("en-US", { timeZone: "UTC" })
  const tzStr = naiveUtc.toLocaleString("en-US", { timeZone: tz })
  const offsetMs = new Date(tzStr).getTime() - new Date(utcStr).getTime()

  // actual UTC time = desired local time − offset
  return new Date(naiveUtc.getTime() - offsetMs)
}

/**
 * Insert post rows into the database. All rows are inserted in a
 * single transaction — either all succeed or none do.
 */
export async function insertPosts(
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
): Promise<void> {
  if (rows.length === 0) return

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

  await db.transaction(async (tx) => {
    await tx.insert(schema.posts).values(values)
  })
}

/**
 * Query posts for a client within a date range (inclusive).
 * Returns rows ordered by scheduledDate, then platform.
 */
export async function getPostsByDateRange(
  db: Db,
  clientId: string,
  startDate: string,
  endDate: string
): Promise<Post[]> {
  const rows = await db
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

  return rows as Post[]
}

/**
 * Read rejection counts for rejected posts on specific dates.
 * Read-only — does not delete anything. Call this BEFORE the Claude
 * API call so counts are available even if generation fails.
 *
 * Returns a map keyed by "scheduledDate:platform".
 */
export async function readRejectionCounts(
  db: Db,
  clientId: string,
  scheduledDates: string[]
): Promise<Map<string, number>> {
  if (scheduledDates.length === 0) return new Map()

  const rejected = await db
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
export async function replacePostsForOpenDays(
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
): Promise<void> {
  await db.transaction(async (tx) => {
    // Delete replaceable posts
    if (scheduledDates.length > 0) {
      await tx
        .delete(schema.posts)
        .where(
          and(
            eq(schema.posts.clientId, clientId),
            inArray(schema.posts.scheduledDate, scheduledDates),
            inArray(schema.posts.status, REPLACEABLE_STATUSES)
          )
        )
    }

    // Insert new rows
    if (newRows.length > 0) {
      const values = newRows.map((row) => ({
        clientId: row.clientId,
        platform: row.platform,
        scheduledDate: row.scheduledDate,
        status: row.status ?? "draft",
        content: row.content,
        photoId: row.photoId ?? null,
        reasoning: row.reasoning,
        rejectionCount: row.rejectionCount ?? 0,
      }))
      await tx.insert(schema.posts).values(values)
    }
  })
}

/**
 * Find days in a date range that have at least one locked post
 * (approved, published, or failed). These days cannot be regenerated.
 */
export async function getLockedDays(
  db: Db,
  clientId: string,
  startDate: string,
  endDate: string
): Promise<LockedDay[]> {
  const rows = await db
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
export async function getPostById(
  db: Db,
  postId: string,
  clientId: string
): Promise<Post | null> {
  const rows = await db
    .select(postSelect)
    .from(schema.posts)
    .leftJoin(schema.photos, eq(schema.posts.photoId, schema.photos.id))
    .where(
      and(
        eq(schema.posts.id, postId),
        eq(schema.posts.clientId, clientId)
      )
    )
    .limit(1)

  return (rows[0] as Post | undefined) ?? null
}

/**
 * Approve a draft post. Optionally updates the content (e.g. after
 * client edits). Throws if the post is not found or not in draft status.
 */
export async function approvePost(
  db: Db,
  postId: string,
  clientId: string,
  newContent?: string
): Promise<Post> {
  const post = await getPostById(db, postId, clientId)

  if (!post) {
    throw new Error(`Post not found: ${postId}`)
  }
  if (post.status !== "draft") {
    throw new Error(`Cannot approve post with status "${post.status}"`)
  }

  const now = new Date()
  const { postTime, timezone } = await getClientScheduleInfo(db, clientId)
  const updates: Record<string, unknown> = {
    status: "approved",
    approvedAt: now,
    publishAt: buildPublishAt(post.scheduledDate, postTime, timezone),
    updatedAt: now,
  }
  if (newContent !== undefined) {
    updates.content = newContent
  }

  const result = await db
    .update(schema.posts)
    .set(updates)
    .where(
      and(
        eq(schema.posts.id, postId),
        eq(schema.posts.clientId, clientId),
        eq(schema.posts.status, "draft")
      )
    )

  assertChanged(
    result,
    `Post not found: ${postId}`,
    "Cannot approve post because it is no longer a draft"
  )

  return (await getPostById(db, postId, clientId)) as Post
}

/**
 * Reject a draft post. Sets status to "rejected", records the
 * timestamp, and increments the rejection count.
 * Throws if the post is not found or not in draft status.
 */
export async function rejectPost(
  db: Db,
  postId: string,
  clientId: string
): Promise<Post> {
  const post = await getPostById(db, postId, clientId)

  if (!post) {
    throw new Error(`Post not found: ${postId}`)
  }
  if (post.status !== "draft") {
    throw new Error(`Cannot reject post with status "${post.status}"`)
  }

  const now = new Date()

  const result = await db
    .update(schema.posts)
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

  assertChanged(
    result,
    `Post not found: ${postId}`,
    "Cannot reject post because it is no longer a draft"
  )

  return (await getPostById(db, postId, clientId)) as Post
}

/**
 * Replace a post's content and reasoning after regeneration.
 * Increments rejectionCount, resets status to "draft", and
 * updates the timestamp. Throws if the post is not found.
 */
export async function regeneratePost(
  db: Db,
  postId: string,
  clientId: string,
  newContent: string,
  newReasoning: string
): Promise<Post> {
  const post = await getPostById(db, postId, clientId)

  if (!post) {
    throw new Error(`Post not found: ${postId}`)
  }
  if (post.status !== "draft") {
    throw new Error(`Cannot regenerate post with status "${post.status}"`)
  }

  const now = new Date()

  const result = await db
    .update(schema.posts)
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

  assertChanged(
    result,
    `Post not found: ${postId}`,
    "Cannot regenerate post because it is no longer a draft"
  )

  return (await getPostById(db, postId, clientId)) as Post
}

/**
 * Stamp `firstSeenAt = now` on every post in `postIds` belonging to
 * `clientId` whose `firstSeenAt` is currently NULL. Posts that already
 * have a `firstSeenAt` are not overwritten. Posts owned by other clients
 * are silently skipped (tenant isolation).
 *
 * Safe to call on every dashboard load. Single UPDATE statement; Postgres
 * handles the IN clause natively.
 */
export async function markPostsAsSeen(
  db: Db,
  postIds: string[],
  clientId: string,
  now: Date = new Date()
): Promise<void> {
  if (postIds.length === 0) return

  await db
    .update(schema.posts)
    .set({ firstSeenAt: now })
    .where(
      and(
        eq(schema.posts.clientId, clientId),
        inArray(schema.posts.id, postIds),
        isNull(schema.posts.firstSeenAt)
      )
    )
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
export async function findStalePosts(db: Db, now: Date): Promise<StalePost[]> {
  const cutoff = new Date(now.getTime() - TWENTY_FOUR_HOURS_MS)

  const rows = await db
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

  return rows as StalePost[]
}

/**
 * Mark a single post as alerted. Idempotent — running twice has no effect
 * because the WHERE clause requires alertedAt IS NULL.
 */
export async function markPostAlerted(
  db: Db,
  postId: string,
  now: Date = new Date()
): Promise<void> {
  await db
    .update(schema.posts)
    .set({ alertedAt: now })
    .where(
      and(
        eq(schema.posts.id, postId),
        isNull(schema.posts.alertedAt)
      )
    )
}

export interface RegenLimitPost {
  id: string
  clientId: string
  businessName: string
  platform: "instagram" | "facebook"
  scheduledDate: string
  content: string
  rejectionCount: number
}

/**
 * Find every draft post that:
 *   - has rejectionCount >= MAX_REJECTIONS (3)
 *   - has NOT yet been alerted (regenLimitAlertedAt IS NULL)
 *
 * Joins clients to include businessName for the email subject.
 *
 * The threshold is `MAX_REJECTIONS` from src/lib/posts/config.ts,
 * which is also enforced in regeneratePostAction.
 */
export async function findPostsAtRegenLimit(db: Db): Promise<RegenLimitPost[]> {
  const rows = await db
    .select({
      id: schema.posts.id,
      clientId: schema.posts.clientId,
      businessName: schema.clients.businessName,
      platform: schema.posts.platform,
      scheduledDate: schema.posts.scheduledDate,
      content: schema.posts.content,
      rejectionCount: schema.posts.rejectionCount,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.posts.clientId, schema.clients.id))
    .where(
      and(
        eq(schema.posts.status, "draft"),
        gte(schema.posts.rejectionCount, MAX_REJECTIONS),
        isNull(schema.posts.regenLimitAlertedAt)
      )
    )

  return rows as RegenLimitPost[]
}

/**
 * Mark a single post as alerted for hitting the regen limit.
 * Idempotent — running twice has no effect because the WHERE clause
 * requires regenLimitAlertedAt IS NULL.
 */
export async function markPostRegenLimitAlerted(
  db: Db,
  postId: string,
  now: Date = new Date()
): Promise<void> {
  await db
    .update(schema.posts)
    .set({ regenLimitAlertedAt: now })
    .where(
      and(
        eq(schema.posts.id, postId),
        isNull(schema.posts.regenLimitAlertedAt)
      )
    )
}
