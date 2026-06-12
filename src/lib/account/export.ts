import { eq, inArray } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { PostStatus } from "@/lib/posts/config"

type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

// v2 adds metaConnections, postFlags and publishAttempts to the export.
export const EXPORT_SCHEMA_VERSION = 2

export interface UserExport {
  id: string
  email: string
  name: string | null
  role: "client" | "admin"
  createdAt: string
}

export interface ClientExport {
  id: string
  businessName: string
  location: string | null
  industry: string | null
  businessType: string | null
  productsServices: string | null
  logoUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface PhotoExport {
  id: string
  blobUrl: string
  originalFilename: string
  mimeType: string
  sizeBytes: number
  analysis: unknown
  analyzedAt: string | null
  createdAt: string
}

export interface PostExport {
  id: string
  platform: "instagram" | "facebook"
  scheduledDate: string
  status: PostStatus
  content: string
  photoId: string | null
  reasoning: string
  publishAt: string | null
  rejectionCount: number
  approvedAt: string | null
  rejectedAt: string | null
  publishedAt: string | null
  publishError: string | null
  firstSeenAt: string | null
  createdAt: string
  updatedAt: string
}

export interface DeletionRequestExport {
  requestedAt: string
  scheduledFor: string
  cancelledAt: string | null
}

// The access token is deliberately omitted — it is a secret and never exported.
export interface MetaConnectionExport {
  pageId: string
  pageName: string
  instagramBusinessId: string | null
  grantedScopes: string
  connectedAt: string
  lastValidatedAt: string | null
  expiresAt: string | null
}

export interface PostFlagExport {
  postId: string
  reason: string | null
  flaggedAt: string
  resolvedAt: string | null
}

export interface PublishAttemptExport {
  postId: string
  attemptedAt: string
  attemptedBy: string
  metaPostId: string | null
  success: boolean
  errorClass: string | null
  errorMessage: string | null
}

export interface DataExport {
  schemaVersion: number
  exportedAt: string
  user: UserExport | null
  client: ClientExport | null
  photos: PhotoExport[]
  posts: PostExport[]
  metaConnections: MetaConnectionExport[]
  postFlags: PostFlagExport[]
  publishAttempts: PublishAttemptExport[]
  deletionRequest: DeletionRequestExport | null
}

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}

export async function buildExportJson(
  db: Db,
  userId: string,
  now: Date
): Promise<DataExport> {
  const userRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1)
  const userRow = userRows[0]

  if (!userRow) {
    return {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: now.toISOString(),
      user: null,
      client: null,
      photos: [],
      posts: [],
      metaConnections: [],
      postFlags: [],
      publishAttempts: [],
      deletionRequest: null,
    }
  }

  const user: UserExport = {
    id: userRow.id,
    email: userRow.email,
    name: userRow.name,
    role: userRow.role,
    createdAt: userRow.createdAt.toISOString(),
  }

  const clientRows = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.userId, userId))
    .limit(1)
  const clientRow = clientRows[0]

  if (!clientRow) {
    const deletionRequest = await readDeletionRequest(db, userId)
    return {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: now.toISOString(),
      user,
      client: null,
      photos: [],
      posts: [],
      metaConnections: [],
      postFlags: [],
      publishAttempts: [],
      deletionRequest,
    }
  }

  const client: ClientExport = {
    id: clientRow.id,
    businessName: clientRow.businessName,
    location: clientRow.location,
    industry: clientRow.industry,
    businessType: clientRow.businessType,
    productsServices: clientRow.productsServices,
    logoUrl: clientRow.logoUrl,
    createdAt: clientRow.createdAt.toISOString(),
    updatedAt: clientRow.updatedAt.toISOString(),
  }

  const photoRows = await db
    .select()
    .from(schema.photos)
    .where(eq(schema.photos.clientId, clientRow.id))

  const photos: PhotoExport[] = photoRows.map((p) => ({
    id: p.id,
    blobUrl: p.blobUrl,
    originalFilename: p.originalFilename,
    mimeType: p.mimeType,
    sizeBytes: p.sizeBytes,
    analysis: p.analysis,
    analyzedAt: toIso(p.analyzedAt),
    createdAt: p.createdAt.toISOString(),
  }))

  const postRows = await db
    .select()
    .from(schema.posts)
    .where(eq(schema.posts.clientId, clientRow.id))

  const posts: PostExport[] = postRows.map((p) => ({
    id: p.id,
    platform: p.platform,
    scheduledDate: p.scheduledDate,
    status: p.status,
    content: p.content,
    photoId: p.photoId,
    reasoning: p.reasoning,
    publishAt: toIso(p.publishAt),
    rejectionCount: p.rejectionCount,
    approvedAt: toIso(p.approvedAt),
    rejectedAt: toIso(p.rejectedAt),
    publishedAt: toIso(p.publishedAt),
    publishError: p.publishError,
    firstSeenAt: toIso(p.firstSeenAt),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }))

  const connectionRows = await db
    .select()
    .from(schema.metaConnections)
    .where(eq(schema.metaConnections.clientId, clientRow.id))

  const metaConnections: MetaConnectionExport[] = connectionRows.map((c) => ({
    pageId: c.pageId,
    pageName: c.pageName,
    instagramBusinessId: c.instagramBusinessId,
    grantedScopes: c.grantedScopes,
    connectedAt: c.connectedAt.toISOString(),
    lastValidatedAt: toIso(c.lastValidatedAt),
    expiresAt: toIso(c.expiresAt),
  }))

  const flagRows = await db
    .select()
    .from(schema.postFlags)
    .where(eq(schema.postFlags.clientId, clientRow.id))

  const postFlags: PostFlagExport[] = flagRows.map((f) => ({
    postId: f.postId,
    reason: f.reason,
    flaggedAt: f.flaggedAt.toISOString(),
    resolvedAt: toIso(f.resolvedAt),
  }))

  // publish_attempts has no clientId; it links to the client via their posts.
  const postIds = postRows.map((p) => p.id)
  const attemptRows =
    postIds.length > 0
      ? await db
          .select()
          .from(schema.publishAttempts)
          .where(inArray(schema.publishAttempts.postId, postIds))
      : []

  const publishAttempts: PublishAttemptExport[] = attemptRows.map((a) => ({
    postId: a.postId,
    attemptedAt: a.attemptedAt.toISOString(),
    attemptedBy: a.attemptedBy,
    metaPostId: a.metaPostId,
    success: a.success,
    errorClass: a.errorClass,
    errorMessage: a.errorMessage,
  }))

  const deletionRequest = await readDeletionRequest(db, userId)

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    user,
    client,
    photos,
    posts,
    metaConnections,
    postFlags,
    publishAttempts,
    deletionRequest,
  }
}

async function readDeletionRequest(
  db: Db,
  userId: string
): Promise<DeletionRequestExport | null> {
  const rows = await db
    .select({
      requestedAt: schema.deletionRequests.requestedAt,
      scheduledFor: schema.deletionRequests.scheduledFor,
      cancelledAt: schema.deletionRequests.cancelledAt,
      completedAt: schema.deletionRequests.completedAt,
    })
    .from(schema.deletionRequests)
    .where(eq(schema.deletionRequests.userId, userId))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  if (row.completedAt !== null) return null

  return {
    requestedAt: row.requestedAt.toISOString(),
    scheduledFor: row.scheduledFor.toISOString(),
    cancelledAt: toIso(row.cancelledAt),
  }
}
