import { eq } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"

type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export interface MetaConnection {
  id: string
  clientId: string
  pageId: string
  pageName: string
  instagramBusinessId: string | null
  encryptedAccessToken: string
  grantedScopes: string
  connectedAt: Date
  lastValidatedAt: Date | null
  expiresAt: Date | null
}

export interface UpsertConnectionInput {
  clientId: string
  pageId: string
  pageName: string
  instagramBusinessId: string | null
  encryptedAccessToken: string
  grantedScopes: string
  expiresAt?: Date | null
}

/**
 * Insert or replace a connection row for a (clientId, pageId) pair. If a
 * row already exists, its encrypted token + IG id + name are overwritten
 * and `connectedAt` is bumped to "now".
 */
export async function upsertConnection(
  db: Db,
  input: UpsertConnectionInput
): Promise<void> {
  const now = new Date()
  await db
    .insert(schema.metaConnections)
    .values({
      clientId: input.clientId,
      pageId: input.pageId,
      pageName: input.pageName,
      instagramBusinessId: input.instagramBusinessId,
      encryptedAccessToken: input.encryptedAccessToken,
      grantedScopes: input.grantedScopes,
      expiresAt: input.expiresAt ?? null,
      connectedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.metaConnections.clientId, schema.metaConnections.pageId],
      set: {
        pageName: input.pageName,
        instagramBusinessId: input.instagramBusinessId,
        encryptedAccessToken: input.encryptedAccessToken,
        grantedScopes: input.grantedScopes,
        expiresAt: input.expiresAt ?? null,
        connectedAt: now,
      },
    })
}

/**
 * Get the active connection for a client. v1 assumes one page per client;
 * if multiple rows exist (future multi-page support), returns the most
 * recently connected.
 */
export async function getConnectionByClient(
  db: Db,
  clientId: string
): Promise<MetaConnection | null> {
  const rows = await db
    .select()
    .from(schema.metaConnections)
    .where(eq(schema.metaConnections.clientId, clientId))
    .orderBy(schema.metaConnections.connectedAt)
    .limit(1)

  return (rows[0] as MetaConnection | undefined) ?? null
}

/**
 * Remove every connection row for this client. Used by the disconnect
 * action. The actual Meta access token is not revoked on Meta's side —
 * that would require a separate `DELETE /me/permissions` call which we
 * skip in v1 (tokens silently expire if unused).
 */
export async function deleteConnectionByClient(
  db: Db,
  clientId: string
): Promise<void> {
  await db
    .delete(schema.metaConnections)
    .where(eq(schema.metaConnections.clientId, clientId))
}
