import { eq } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"

type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export interface DeleteUserDeps {
  deleteBlob: (url: string) => Promise<void>
}

export interface DeleteUserResult {
  deletedPhotoCount: number
  failedBlobCount: number
}

/**
 * Delete a user and everything that hangs off them. Steps, in order:
 *   1. Read the user (need email for audit).
 *   2. Read all photo blob URLs for the user's client.
 *   3. Write the audit log BEFORE the delete (so the record survives any
 *      partial failure of step 5).
 *   4. Best-effort: delete each blob via `deps.deleteBlob`. Failures are
 *      logged and counted but do not abort.
 *   5. Delete the user row. FK cascade propagates through clients, photos,
 *      posts, sessions, accounts, verificationTokens, deletionRequests.
 *
 * `deletedBy` is the actor id (the user themselves for client-initiated,
 * an admin user id for admin-initiated). It is stored in the audit log.
 */
export async function deleteUserAccount(
  db: Db,
  userId: string,
  deletedBy: string,
  deps: DeleteUserDeps,
  now?: Date
): Promise<DeleteUserResult> {
  const userRows = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1)
  const user = userRows[0]
  if (!user) {
    throw new Error(`User ${userId} not found`)
  }

  const clientRows = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(eq(schema.clients.userId, userId))

  let blobUrls: string[] = []
  for (const client of clientRows) {
    const photos = await db
      .select({ blobUrl: schema.photos.blobUrl })
      .from(schema.photos)
      .where(eq(schema.photos.clientId, client.id))
    blobUrls = blobUrls.concat(photos.map((p) => p.blobUrl))
  }

  await db.insert(schema.deletionAuditLog).values({
    deletedUserEmail: user.email,
    deletedUserId: user.id,
    deletedBy,
    deletedAt: now ?? new Date(),
  })

  let failedBlobCount = 0
  for (const url of blobUrls) {
    try {
      await deps.deleteBlob(url)
    } catch (error: unknown) {
      failedBlobCount++
      console.error("[deleteUserAccount] Failed to delete blob", {
        url,
        userId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  await db.delete(schema.users).where(eq(schema.users.id, userId))

  return {
    deletedPhotoCount: blobUrls.length,
    failedBlobCount,
  }
}
