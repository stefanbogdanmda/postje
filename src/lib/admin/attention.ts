import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm"
import * as schema from "@/db/schema"

/** Any Postgres-dialect Drizzle database (Neon in prod, PGlite in tests). */
type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export type AttentionSignal =
  | "failed"
  | "overdue"
  | "stale"
  | "regen-limit"
  | "unseen"
  | "rejected"

export interface AttentionItem {
  signalType: AttentionSignal
  postId: string
  clientId: string
  businessName: string
  platform: "instagram" | "facebook"
  scheduledDate: string
  signalAt: Date
  contentPreview: string
}

export interface CalibrationItem {
  clientId: string
  businessName: string
  joinedAt: Date
  postCount: number
}

export interface AttentionData {
  failedPosts: AttentionItem[]
  overduePosts: AttentionItem[]
  staleDrafts: AttentionItem[]
  regenLimitHits: AttentionItem[]
  unseenDrafts: AttentionItem[]
  recentRejections: AttentionItem[]
  calibrationClients: CalibrationItem[]
}

const PREVIEW_LENGTH = 80

function preview(content: string): string {
  return content.length <= PREVIEW_LENGTH ? content : content.slice(0, PREVIEW_LENGTH)
}

const itemSelect = {
  postId: schema.posts.id,
  clientId: schema.posts.clientId,
  platform: schema.posts.platform,
  scheduledDate: schema.posts.scheduledDate,
  content: schema.posts.content,
  businessName: schema.clients.businessName,
}

export async function findFailedPosts(db: Db, _now: Date): Promise<AttentionItem[]> {
  const rows = await db
    .select({
      ...itemSelect,
      signalAt: schema.posts.updatedAt,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.posts.clientId))
    .where(or(eq(schema.posts.status, "failed"), isNotNull(schema.posts.publishError)))
    .orderBy(asc(schema.posts.updatedAt))

  return rows.map((r) => ({
    signalType: "failed" as const,
    postId: r.postId,
    clientId: r.clientId,
    businessName: r.businessName,
    platform: r.platform as "instagram" | "facebook",
    scheduledDate: r.scheduledDate,
    signalAt: r.signalAt,
    contentPreview: preview(r.content),
  }))
}

export async function findOverduePosts(db: Db, now: Date): Promise<AttentionItem[]> {
  const rows = await db
    .select({
      ...itemSelect,
      signalAt: schema.posts.publishAt,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.posts.clientId))
    .where(and(
      eq(schema.posts.status, "approved"),
      isNull(schema.posts.publishedAt),
      sql`${schema.posts.publishAt} < ${now}`,
    ))
    .orderBy(asc(schema.posts.publishAt))

  return rows.map((r) => ({
    signalType: "overdue" as const,
    postId: r.postId,
    clientId: r.clientId,
    businessName: r.businessName,
    platform: r.platform as "instagram" | "facebook",
    scheduledDate: r.scheduledDate,
    signalAt: r.signalAt as Date,
    contentPreview: preview(r.content),
  }))
}

export async function findStaleDrafts(db: Db, _now: Date): Promise<AttentionItem[]> {
  // Spec: sorted by firstSeenAt ascending. Posts that have been alerted
  // always have firstSeenAt set (alerts only fire on seen drafts), but
  // we coalesce to alertedAt as a defensive fallback.
  const rows = await db
    .select({
      ...itemSelect,
      signalAt: schema.posts.alertedAt,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.posts.clientId))
    .where(and(
      eq(schema.posts.status, "draft"),
      isNotNull(schema.posts.alertedAt),
    ))
    .orderBy(asc(sql`coalesce(${schema.posts.firstSeenAt}, ${schema.posts.alertedAt})`))

  return rows.map((r) => ({
    signalType: "stale" as const,
    postId: r.postId,
    clientId: r.clientId,
    businessName: r.businessName,
    platform: r.platform as "instagram" | "facebook",
    scheduledDate: r.scheduledDate,
    signalAt: r.signalAt as Date,
    contentPreview: preview(r.content),
  }))
}

export async function findRegenLimitHits(db: Db, _now: Date): Promise<AttentionItem[]> {
  const rows = await db
    .select({
      ...itemSelect,
      signalAt: schema.posts.regenLimitAlertedAt,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.posts.clientId))
    .where(and(
      eq(schema.posts.status, "draft"),
      isNotNull(schema.posts.regenLimitAlertedAt),
    ))
    .orderBy(asc(schema.posts.regenLimitAlertedAt))

  return rows.map((r) => ({
    signalType: "regen-limit" as const,
    postId: r.postId,
    clientId: r.clientId,
    businessName: r.businessName,
    platform: r.platform as "instagram" | "facebook",
    scheduledDate: r.scheduledDate,
    signalAt: r.signalAt as Date,
    contentPreview: preview(r.content),
  }))
}

export async function findUnseenDrafts(db: Db, _now: Date): Promise<AttentionItem[]> {
  const rows = await db
    .select({
      ...itemSelect,
      signalAt: schema.posts.createdAt,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.posts.clientId))
    .where(and(
      eq(schema.posts.status, "draft"),
      isNull(schema.posts.firstSeenAt),
    ))
    .orderBy(asc(schema.posts.createdAt))

  return rows.map((r) => ({
    signalType: "unseen" as const,
    postId: r.postId,
    clientId: r.clientId,
    businessName: r.businessName,
    platform: r.platform as "instagram" | "facebook",
    scheduledDate: r.scheduledDate,
    signalAt: r.signalAt,
    contentPreview: preview(r.content),
  }))
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export async function findRecentRejections(db: Db, now: Date): Promise<AttentionItem[]> {
  const since = new Date(now.getTime() - SEVEN_DAYS_MS)
  const rows = await db
    .select({
      ...itemSelect,
      signalAt: schema.posts.rejectedAt,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.posts.clientId))
    .where(and(
      eq(schema.posts.status, "rejected"),
      sql`${schema.posts.rejectedAt} > ${since}`,
    ))
    .orderBy(asc(schema.posts.rejectedAt))

  return rows.map((r) => ({
    signalType: "rejected" as const,
    postId: r.postId,
    clientId: r.clientId,
    businessName: r.businessName,
    platform: r.platform as "instagram" | "facebook",
    scheduledDate: r.scheduledDate,
    signalAt: r.signalAt as Date,
    contentPreview: preview(r.content),
  }))
}

export async function findCalibrationClients(
  db: Db,
  now: Date
): Promise<CalibrationItem[]> {
  const since = new Date(now.getTime() - SEVEN_DAYS_MS)
  const rows = await db
    .select({
      clientId: schema.clients.id,
      businessName: schema.clients.businessName,
      joinedAt: schema.clients.createdAt,
      postCount: sql<number>`count(${schema.posts.id})::int`,
    })
    .from(schema.clients)
    .leftJoin(schema.posts, eq(schema.posts.clientId, schema.clients.id))
    .where(sql`${schema.clients.createdAt} > ${since}`)
    .groupBy(schema.clients.id, schema.clients.businessName, schema.clients.createdAt)
    .orderBy(asc(schema.clients.createdAt))

  return rows.map((r) => ({
    clientId: r.clientId,
    businessName: r.businessName,
    joinedAt: r.joinedAt,
    postCount: Number(r.postCount),
  }))
}

export async function getAttentionData(db: Db, now: Date): Promise<AttentionData> {
  const [
    failedPosts,
    overduePosts,
    staleDrafts,
    regenLimitHits,
    unseenDrafts,
    recentRejections,
    calibrationClients,
  ] = await Promise.all([
    findFailedPosts(db, now),
    findOverduePosts(db, now),
    findStaleDrafts(db, now),
    findRegenLimitHits(db, now),
    findUnseenDrafts(db, now),
    findRecentRejections(db, now),
    findCalibrationClients(db, now),
  ])

  return {
    failedPosts,
    overduePosts,
    staleDrafts,
    regenLimitHits,
    unseenDrafts,
    recentRejections,
    calibrationClients,
  }
}
