import { eq, and } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"
import { decryptToken } from "./crypto"
import { classifyMetaError, type ErrorClass } from "./errors"
import { getGraphBaseUrl } from "./config"
import { MetaApiError, readJsonOrThrow, type Fetcher } from "./client"

export interface PageCredentials {
  pageId: string
  accessToken: string
}

export interface PostPayload {
  content: string
  photoUrl: string | null
}

/**
 * Publish to a Facebook Page. With a photo: POST /PAGE_ID/photos (returns
 * post_id alongside the photo id). Without: POST /PAGE_ID/feed (returns id).
 * Throws MetaApiError on graph errors.
 */
export async function publishToFacebook(
  creds: PageCredentials,
  payload: PostPayload,
  fetcher: Fetcher = globalThis.fetch
): Promise<string> {
  const baseUrl = getGraphBaseUrl()
  const body = new URLSearchParams({
    message: payload.content,
    access_token: creds.accessToken,
  })

  let endpoint: string
  if (payload.photoUrl) {
    body.set("url", payload.photoUrl)
    endpoint = `${baseUrl}/${creds.pageId}/photos`
  } else {
    endpoint = `${baseUrl}/${creds.pageId}/feed`
  }

  const res = await fetcher(endpoint, { method: "POST", body })
  const json = (await readJsonOrThrow(res)) as {
    id?: string
    post_id?: string
  }

  const metaPostId = json.post_id ?? json.id
  if (!metaPostId) {
    throw new Error("Facebook response is missing both post_id and id")
  }

  return metaPostId
}

export interface InstagramCredentials {
  igUserId: string
  accessToken: string
}

/**
 * Publish to Instagram. Two-step: create a media container, then publish it.
 * Throws MetaApiError if photoUrl is null (IG has no text-only path) or
 * if either Meta call fails.
 */
export async function publishToInstagram(
  creds: InstagramCredentials,
  payload: PostPayload,
  fetcher: Fetcher = globalThis.fetch
): Promise<string> {
  if (!payload.photoUrl) {
    throw new MetaApiError(
      "Instagram posts require a photo; this post has none",
      400
    )
  }
  const baseUrl = getGraphBaseUrl()

  // Step 1: create container
  const containerBody = new URLSearchParams({
    image_url: payload.photoUrl,
    caption: payload.content,
    access_token: creds.accessToken,
  })
  const containerRes = await fetcher(`${baseUrl}/${creds.igUserId}/media`, {
    method: "POST",
    body: containerBody,
  })
  const containerJson = (await readJsonOrThrow(containerRes)) as { id?: string }
  const containerId = containerJson.id
  if (!containerId) {
    throw new MetaApiError("Instagram container response missing id", 200)
  }

  // Step 2: publish container
  const publishBody = new URLSearchParams({
    creation_id: containerId,
    access_token: creds.accessToken,
  })
  const publishRes = await fetcher(`${baseUrl}/${creds.igUserId}/media_publish`, {
    method: "POST",
    body: publishBody,
  })
  const publishJson = (await readJsonOrThrow(publishRes)) as { id?: string }
  if (!publishJson.id) {
    throw new MetaApiError("Instagram publish response missing id", 200)
  }
  return publishJson.id
}

// ─────────────────────────────────────────────────────────
// Orchestrator — the ONLY function external code should call
// ─────────────────────────────────────────────────────────

type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export type GuardFailure =
  | "not-approved"
  | "no-connection"
  | "ig-no-photo"
  | "already-publishing"

export interface PublishResult {
  success: boolean
  metaPostId?: string
  guardFailure?: GuardFailure
  errorClass?: ErrorClass
  errorMessage?: string
}

async function loadJoinedRow(db: Db, postId: string) {
  const rows = await db
    .select({
      postId: schema.posts.id,
      status: schema.posts.status,
      platform: schema.posts.platform,
      content: schema.posts.content,
      photoUrl: schema.photos.blobUrl,
      pageId: schema.metaConnections.pageId,
      igUserId: schema.metaConnections.instagramBusinessId,
      encryptedAccessToken: schema.metaConnections.encryptedAccessToken,
    })
    .from(schema.posts)
    .leftJoin(schema.photos, eq(schema.posts.photoId, schema.photos.id))
    .leftJoin(
      schema.metaConnections,
      eq(schema.metaConnections.clientId, schema.posts.clientId)
    )
    .where(eq(schema.posts.id, postId))
    .limit(1)
  return rows[0] ?? null
}

export async function publishPostToMeta(
  db: Db,
  postId: string,
  attemptedBy: string,
  fetcher: Fetcher = globalThis.fetch
): Promise<PublishResult> {
  const row = await loadJoinedRow(db, postId)
  if (!row) {
    return { success: false, guardFailure: "not-approved" }
  }
  if (row.status !== "approved") {
    return { success: false, guardFailure: "not-approved" }
  }
  if (!row.encryptedAccessToken || !row.pageId) {
    return { success: false, guardFailure: "no-connection" }
  }
  if (row.platform === "instagram" && !row.photoUrl) {
    return { success: false, guardFailure: "ig-no-photo" }
  }

  // Claim the post before calling Meta: atomically move approved -> publishing.
  // Only the invocation that wins this update proceeds, so a cron run and a
  // manual "Publish now" (or two overlapping cron runs) can never both POST the
  // same post to Meta and create a duplicate public post.
  const claimed = await db
    .update(schema.posts)
    .set({ status: "publishing", updatedAt: new Date() })
    .where(and(eq(schema.posts.id, postId), eq(schema.posts.status, "approved")))
    .returning({ id: schema.posts.id })

  if (claimed.length === 0) {
    return { success: false, guardFailure: "already-publishing" }
  }

  const accessToken = decryptToken(row.encryptedAccessToken)
  const start = Date.now()

  try {
    let metaPostId: string
    if (row.platform === "facebook") {
      metaPostId = await publishToFacebook(
        { pageId: row.pageId, accessToken },
        { content: row.content, photoUrl: row.photoUrl },
        fetcher
      )
    } else {
      if (!row.igUserId) {
        return { success: false, guardFailure: "no-connection" }
      }
      metaPostId = await publishToInstagram(
        { igUserId: row.igUserId, accessToken },
        { content: row.content, photoUrl: row.photoUrl },
        fetcher
      )
    }
    const duration = Date.now() - start

    await db.transaction(async (tx) => {
      await tx
        .update(schema.posts)
        .set({
          status: "published",
          publishedAt: new Date(),
          publishError: null,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.posts.id, postId), eq(schema.posts.status, "publishing")))
      await tx.insert(schema.publishAttempts).values({
        postId,
        attemptedBy,
        metaPostId,
        success: true,
        requestDurationMs: duration,
      })
    })

    return { success: true, metaPostId }
  } catch (error: unknown) {
    const duration = Date.now() - start
    const isMeta = error instanceof MetaApiError
    const message =
      error instanceof Error ? error.message : "Onbekende publish-fout"
    const errorClass: ErrorClass = isMeta
      ? classifyMetaError(error.code, error.subcode, error.status)
      : "unknown"
    const errorCode = isMeta && error.code !== undefined ? String(error.code) : null

    await db.transaction(async (tx) => {
      await tx
        .update(schema.posts)
        .set({
          status: "failed",
          publishError: message,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.posts.id, postId), eq(schema.posts.status, "publishing")))
      await tx.insert(schema.publishAttempts).values({
        postId,
        attemptedBy,
        success: false,
        errorClass,
        errorCode,
        errorMessage: message,
        requestDurationMs: duration,
      })
    })

    return { success: false, errorClass, errorMessage: message }
  }
}
