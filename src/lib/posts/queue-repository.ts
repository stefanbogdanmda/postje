import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"

/**
 * Accept any Postgres-dialect Drizzle database. In production this is a
 * NeonDatabase; in tests it's a PgliteDatabase. Both extend PgDatabase.
 */
type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export interface QueuePost {
  id: string
  clientId: string
  businessName: string
  platform: "instagram" | "facebook"
  status: "approved" | "failed"
  scheduledDate: string
  publishAt: Date | null
  content: string
  photoUrl: string | null
  publishError: string | null
  hasMetaConnection: boolean
}

/**
 * Load every post that belongs in the admin publish queue:
 *   - status IN ('approved', 'failed')
 *   - publishedAt IS NULL (not yet successfully published)
 *
 * Sorted failed-first (so the operator sees errors at the top),
 * then by publishAt ascending (oldest scheduled time first).
 *
 * Joins clients for businessName, photos for blobUrl, and
 * metaConnections to surface whether the client has a live
 * connection (needed to show/hide the Publish button).
 */
export async function findQueuePosts(db: Db): Promise<QueuePost[]> {
  const rows = await db
    .select({
      id: schema.posts.id,
      clientId: schema.posts.clientId,
      businessName: schema.clients.businessName,
      platform: schema.posts.platform,
      status: schema.posts.status,
      scheduledDate: schema.posts.scheduledDate,
      publishAt: schema.posts.publishAt,
      content: schema.posts.content,
      photoUrl: schema.photos.blobUrl,
      publishError: schema.posts.publishError,
      metaConnectionId: schema.metaConnections.id,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.posts.clientId, schema.clients.id))
    .leftJoin(schema.photos, eq(schema.posts.photoId, schema.photos.id))
    .leftJoin(
      schema.metaConnections,
      eq(schema.metaConnections.clientId, schema.posts.clientId)
    )
    .where(
      and(
        inArray(schema.posts.status, ["approved", "failed"]),
        isNull(schema.posts.publishedAt)
      )
    )
    .orderBy(desc(schema.posts.status), asc(schema.posts.publishAt))

  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    businessName: r.businessName,
    platform: r.platform as "instagram" | "facebook",
    status: r.status as "approved" | "failed",
    scheduledDate: r.scheduledDate,
    publishAt: r.publishAt,
    content: r.content,
    photoUrl: r.photoUrl,
    publishError: r.publishError,
    hasMetaConnection: r.metaConnectionId !== null,
  }))
}

/**
 * Reset a failed post back to "approved" so it re-enters the publish
 * queue. Clears the publishError field.
 *
 * Only acts on rows whose current status is "failed" — if the post
 * is published, draft, approved, or rejected, the WHERE clause won't
 * match and the update is a safe no-op.
 */
export async function resetFailedPostToApproved(
  db: Db,
  postId: string
): Promise<void> {
  await db
    .update(schema.posts)
    .set({
      status: "approved",
      publishError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.posts.id, postId), eq(schema.posts.status, "failed")))
}
