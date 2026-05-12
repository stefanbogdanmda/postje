import { eq, and, isNull, lte } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"

type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export const DELETION_COOLING_OFF_HOURS = 24
export const DELETION_COOLING_OFF_MS =
  DELETION_COOLING_OFF_HOURS * 60 * 60 * 1000

export interface DeletionRequest {
  id: string
  userId: string
  cancelToken: string
  requestedAt: Date
  scheduledFor: Date
  cancelledAt: Date | null
  completedAt: Date | null
}

export function generateCancelToken(): string {
  return crypto.randomUUID()
}

/**
 * Find an *active* deletion request (not cancelled, not completed) for a user.
 * Returns null if no row exists or if the existing row is cancelled/completed.
 */
export async function getActiveDeletionRequest(
  db: Db,
  userId: string
): Promise<DeletionRequest | null> {
  const rows = await db
    .select()
    .from(schema.deletionRequests)
    .where(eq(schema.deletionRequests.userId, userId))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  if (row.cancelledAt !== null) return null
  if (row.completedAt !== null) return null

  return row
}

/**
 * Create a deletion request if none is active. If a cancelled/completed
 * row exists for this user, it is replaced (deleted then inserted) so the
 * unique constraint on userId is satisfied.
 */
export async function createOrGetDeletionRequest(
  db: Db,
  userId: string,
  now: Date
): Promise<DeletionRequest> {
  const existing = await getActiveDeletionRequest(db, userId)
  if (existing) return existing

  await db
    .delete(schema.deletionRequests)
    .where(eq(schema.deletionRequests.userId, userId))

  const scheduledFor = new Date(now.getTime() + DELETION_COOLING_OFF_MS)
  const inserted = await db
    .insert(schema.deletionRequests)
    .values({
      userId,
      cancelToken: generateCancelToken(),
      requestedAt: now,
      scheduledFor,
    })
    .returning()

  const row = inserted[0]
  if (!row) {
    throw new Error("deletion request insert returned no rows")
  }
  return row
}

/**
 * Cancel by token (used by the email link). Stamps `cancelledAt` only when
 * the matching row is still active. Returns `cancelled: false` for unknown
 * tokens or already-cancelled/completed rows so the caller can render a
 * generic "link no longer valid" page without leaking existence.
 */
export async function cancelDeletionRequestByToken(
  db: Db,
  token: string,
  now: Date
): Promise<{ cancelled: boolean }> {
  const rows = await db
    .select()
    .from(schema.deletionRequests)
    .where(eq(schema.deletionRequests.cancelToken, token))
    .limit(1)

  const row = rows[0]
  if (!row) return { cancelled: false }
  if (row.cancelledAt !== null) return { cancelled: false }
  if (row.completedAt !== null) return { cancelled: false }

  await db
    .update(schema.deletionRequests)
    .set({ cancelledAt: now })
    .where(eq(schema.deletionRequests.id, row.id))

  return { cancelled: true }
}

/**
 * Cancel by user id (used by the in-app "Annuleren" button on the dashboard).
 */
export async function cancelDeletionRequestForUser(
  db: Db,
  userId: string,
  now: Date
): Promise<{ cancelled: boolean }> {
  const active = await getActiveDeletionRequest(db, userId)
  if (!active) return { cancelled: false }

  await db
    .update(schema.deletionRequests)
    .set({ cancelledAt: now })
    .where(eq(schema.deletionRequests.id, active.id))

  return { cancelled: true }
}

/**
 * Returns requests whose scheduledFor has passed and that are neither
 * cancelled nor completed. Used by the hourly cron sweep.
 */
export async function findDueDeletionRequests(
  db: Db,
  now: Date
): Promise<DeletionRequest[]> {
  return db
    .select()
    .from(schema.deletionRequests)
    .where(
      and(
        lte(schema.deletionRequests.scheduledFor, now),
        isNull(schema.deletionRequests.cancelledAt),
        isNull(schema.deletionRequests.completedAt)
      )
    )
}

export async function markDeletionCompleted(
  db: Db,
  requestId: string,
  now: Date
): Promise<void> {
  await db
    .update(schema.deletionRequests)
    .set({ completedAt: now })
    .where(eq(schema.deletionRequests.id, requestId))
}
