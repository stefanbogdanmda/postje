import { eq, and, isNull, asc } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"

type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export interface QueueItem {
  postId: string
  clientId: string
  businessName: string
  platform: "instagram" | "facebook"
  scheduledDate: string
  publishAt: Date | null
  content: string
  photoUrl: string | null
  hasMetaConnection: boolean
}

/**
 * Return all posts that are approved but not yet published, ordered by
 * publishAt ascending (soonest first). Joined with the client's business
 * name and (left-joined) photo URL.
 */
export async function getQueueItems(db: Db): Promise<QueueItem[]> {
  const rows = await db
    .select({
      postId: schema.posts.id,
      clientId: schema.posts.clientId,
      businessName: schema.clients.businessName,
      platform: schema.posts.platform,
      scheduledDate: schema.posts.scheduledDate,
      publishAt: schema.posts.publishAt,
      content: schema.posts.content,
      photoUrl: schema.photos.blobUrl,
      connectionId: schema.metaConnections.id,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.posts.clientId))
    .leftJoin(schema.photos, eq(schema.photos.id, schema.posts.photoId))
    .leftJoin(schema.metaConnections, eq(schema.metaConnections.clientId, schema.posts.clientId))
    .where(and(eq(schema.posts.status, "approved"), isNull(schema.posts.publishedAt)))
    .orderBy(asc(schema.posts.publishAt))

  return rows.map((row) => ({
    postId: row.postId,
    clientId: row.clientId,
    businessName: row.businessName,
    platform: row.platform,
    scheduledDate: row.scheduledDate,
    publishAt: row.publishAt,
    content: row.content,
    photoUrl: row.photoUrl,
    hasMetaConnection: row.connectionId !== null,
  }))
}
