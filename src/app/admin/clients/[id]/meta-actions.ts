"use server"

import { auth } from "@/lib/auth"
import { db } from "@/db"
import { clients } from "@/db/schema"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { generateOAuthState } from "@/lib/meta/oauth-state"
import { buildAuthUrl } from "@/lib/meta/oauth"
import { deleteConnectionByClient } from "@/lib/meta/repository"

interface UrlResult {
  url?: string
  error?: string
}

interface DisconnectResult {
  ok?: true
  error?: string
}

/**
 * Build the Meta OAuth dialog URL for this client. The page calls this
 * server action and then `window.location.assign(url)` from the client
 * component. State is generated and signed here, server-side.
 */
export async function getMetaConnectUrlAction(
  clientId: string
): Promise<UrlResult> {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return { error: "Unauthorized" }
  }
  const rows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)
  if (rows.length === 0) {
    return { error: "Client not found" }
  }
  const state = generateOAuthState(clientId)
  return { url: buildAuthUrl(state) }
}

/**
 * Disconnect Meta for this client. Deletes the meta_connections row.
 * Does NOT revoke the access token on Meta's side — see repository.ts
 * for the rationale.
 */
export async function disconnectMetaAction(
  clientId: string
): Promise<DisconnectResult> {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return { error: "Unauthorized" }
  }
  await deleteConnectionByClient(db, clientId)
  revalidatePath(`/admin/clients/${clientId}`)
  return { ok: true }
}
