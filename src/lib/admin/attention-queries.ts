import { and, eq, lt, isNull, isNotNull, sql, count } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"

type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

// ── Interfaces ──────────────────────────────────

export interface RegenLimitClient {
  clientId: string
  businessName: string
  postId: string
  rejectionCount: number
  scheduledDate: string
}

export interface StaleApprovalPost {
  postId: string
  clientId: string
  businessName: string
  platform: string
  scheduledDate: string
  firstSeenAt: Date
  hoursWaiting: number
}

export interface CalibrationClient {
  clientId: string
  businessName: string
  calibrationStartDate: Date
  daysInCalibration: number
  pendingPostCount: number
}

export interface FlaggedPost {
  flagId: string
  postId: string
  clientId: string
  businessName: string
  content: string
  reason: string | null
  flaggedAt: Date
}

export interface FailedPublish {
  postId: string
  clientId: string
  businessName: string
  platform: string
  publishError: string | null
  scheduledDate: string
}

// ── Queries ─────────────────────────────────────

/** Clients with posts that hit the 3-rejection limit */
export async function findRegenLimitClients(
  db: Db
): Promise<RegenLimitClient[]> {
  const rows = await db
    .select({
      clientId: schema.posts.clientId,
      businessName: schema.clients.businessName,
      postId: schema.posts.id,
      rejectionCount: schema.posts.rejectionCount,
      scheduledDate: schema.posts.scheduledDate,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.posts.clientId, schema.clients.id))
    .where(
      and(
        eq(schema.posts.status, "rejected"),
        sql`${schema.posts.rejectionCount} >= 3`
      )
    )
    .orderBy(schema.posts.updatedAt)
    .limit(20)

  return rows.map((r) => ({
    clientId: r.clientId,
    businessName: r.businessName,
    postId: r.postId,
    rejectionCount: r.rejectionCount,
    scheduledDate: r.scheduledDate,
  }))
}

/** Posts waiting for approval for more than 24 hours */
export async function findStaleApprovalPosts(
  db: Db
): Promise<StaleApprovalPost[]> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const rows = await db
    .select({
      postId: schema.posts.id,
      clientId: schema.posts.clientId,
      businessName: schema.clients.businessName,
      platform: schema.posts.platform,
      scheduledDate: schema.posts.scheduledDate,
      firstSeenAt: schema.posts.firstSeenAt,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.posts.clientId, schema.clients.id))
    .where(
      and(
        eq(schema.posts.status, "draft"),
        isNotNull(schema.posts.firstSeenAt),
        lt(schema.posts.firstSeenAt, twentyFourHoursAgo)
      )
    )
    .orderBy(schema.posts.firstSeenAt)
    .limit(20)

  return rows.map((r) => ({
    postId: r.postId,
    clientId: r.clientId,
    businessName: r.businessName,
    platform: r.platform,
    scheduledDate: r.scheduledDate,
    firstSeenAt: r.firstSeenAt!,
    hoursWaiting: Math.round(
      (Date.now() - r.firstSeenAt!.getTime()) / (1000 * 60 * 60)
    ),
  }))
}

/** Clients currently in calibration (first 14 days) */
export async function findCalibrationClients(
  db: Db
): Promise<CalibrationClient[]> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)

  // The calibration window starts at calibrationStartDate when the operator has
  // set one (so it can be extended per client), otherwise at the client's
  // createdAt. COALESCE handles both, including older clients created before
  // calibrationStartDate was populated on signup.
  const clientRows = await db
    .select({
      clientId: schema.clients.id,
      businessName: schema.clients.businessName,
      calibrationStartDate: schema.clients.calibrationStartDate,
      createdAt: schema.clients.createdAt,
    })
    .from(schema.clients)
    .where(
      sql`COALESCE(${schema.clients.calibrationStartDate}, ${schema.clients.createdAt}) > ${fourteenDaysAgo}`
    )

  const results: CalibrationClient[] = []
  for (const row of clientRows) {
    const start = row.calibrationStartDate ?? row.createdAt
    const pendingCount = await db
      .select({ count: count() })
      .from(schema.posts)
      .where(
        and(
          eq(schema.posts.clientId, row.clientId),
          eq(schema.posts.status, "draft")
        )
      )

    results.push({
      clientId: row.clientId,
      businessName: row.businessName,
      calibrationStartDate: start,
      daysInCalibration: Math.round(
        (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24)
      ),
      pendingPostCount: Number(pendingCount[0]?.count ?? 0),
    })
  }

  return results
}

/** Posts flagged by clients (unresolved) */
export async function findFlaggedPosts(db: Db): Promise<FlaggedPost[]> {
  const rows = await db
    .select({
      flagId: schema.postFlags.id,
      postId: schema.postFlags.postId,
      clientId: schema.postFlags.clientId,
      businessName: schema.clients.businessName,
      content: schema.posts.content,
      reason: schema.postFlags.reason,
      flaggedAt: schema.postFlags.flaggedAt,
    })
    .from(schema.postFlags)
    .innerJoin(schema.clients, eq(schema.postFlags.clientId, schema.clients.id))
    .innerJoin(schema.posts, eq(schema.postFlags.postId, schema.posts.id))
    .where(isNull(schema.postFlags.resolvedAt))
    .orderBy(schema.postFlags.flaggedAt)
    .limit(20)

  return rows.map((r) => ({
    flagId: r.flagId,
    postId: r.postId,
    clientId: r.clientId,
    businessName: r.businessName,
    content: r.content,
    reason: r.reason,
    flaggedAt: r.flaggedAt,
  }))
}

/** Posts that failed to publish */
export async function findFailedPublishes(db: Db): Promise<FailedPublish[]> {
  const rows = await db
    .select({
      postId: schema.posts.id,
      clientId: schema.posts.clientId,
      businessName: schema.clients.businessName,
      platform: schema.posts.platform,
      publishError: schema.posts.publishError,
      scheduledDate: schema.posts.scheduledDate,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.posts.clientId, schema.clients.id))
    .where(eq(schema.posts.status, "failed"))
    .orderBy(schema.posts.updatedAt)
    .limit(20)

  return rows.map((r) => ({
    postId: r.postId,
    clientId: r.clientId,
    businessName: r.businessName,
    platform: r.platform,
    publishError: r.publishError,
    scheduledDate: r.scheduledDate,
  }))
}
