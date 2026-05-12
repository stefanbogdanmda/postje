import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"
import { findDueDeletionRequests } from "./deletion-request"
import { deleteUserAccount, type DeleteUserDeps } from "./delete"

type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export interface ProcessDueDeletionsResult {
  processed: number
  failed: number
}

/**
 * Process every deletion request that is now due (scheduledFor <= now,
 * uncancelled, uncompleted). Each row is handled in its own try/catch:
 * failures are logged and counted but never block the rest of the batch.
 *
 * Note: we don't call `markDeletionCompleted` before deletion — the
 * `deletion_requests` row is cascade-deleted when the user is removed via
 * FK. That is the success signal. A retry on the next cron run is automatic
 * for rows that failed (the row is still there with cancelledAt=NULL).
 */
export async function processDueDeletions(
  db: Db,
  deps: DeleteUserDeps,
  now: Date
): Promise<ProcessDueDeletionsResult> {
  const due = await findDueDeletionRequests(db, now)

  let processed = 0
  let failed = 0

  for (const request of due) {
    try {
      await deleteUserAccount(db, request.userId, request.userId, deps, now)
      processed++
    } catch (error: unknown) {
      failed++
      console.error("[processDueDeletions] Failed to delete user", {
        userId: request.userId,
        requestId: request.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { processed, failed }
}
