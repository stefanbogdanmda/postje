import { eq, and } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"
import { getGraphBaseUrl } from "./config"
import { metaFetch, type Fetcher } from "./graph-client"
import { classifyMetaError, type MetaErrorClass } from "./errors"
import {
  getDecryptedConnectionByClient,
  insertPublishAttempt,
  type DecryptedConnection,
} from "./repository"

type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export interface PublishDeps {
  fetcher: Fetcher
  now: Date
}

export interface PublishOk {
  ok: true
  metaPostId: string
}

export interface PublishErr {
  ok: false
  errorClass: MetaErrorClass | "precondition"
  errorCode: string | null
  errorMessage: string
}

export type PublishResult = PublishOk | PublishErr

interface PostWithPhoto {
  id: string
  clientId: string
  platform: "facebook" | "instagram"
  status: string
  content: string
  photoUrl: string | null
}

async function loadPostForPublish(
  db: Db,
  postId: string
): Promise<PostWithPhoto | null> {
  const rows = await db
    .select({
      id: schema.posts.id,
      clientId: schema.posts.clientId,
      platform: schema.posts.platform,
      status: schema.posts.status,
      content: schema.posts.content,
      photoUrl: schema.photos.blobUrl,
    })
    .from(schema.posts)
    .leftJoin(schema.photos, eq(schema.photos.id, schema.posts.photoId))
    .where(eq(schema.posts.id, postId))
    .limit(1)
  return rows[0] ?? null
}

function preconditionError(message: string): PublishErr {
  return {
    ok: false,
    errorClass: "precondition",
    errorCode: null,
    errorMessage: message,
  }
}

/**
 * Publish a single approved post to Meta. Always resolves with a
 * tagged result so callers can branch on `.ok`. On failure, the post
 * is marked `failed` with `publishError` set, and a `publish_attempts`
 * row is appended. On precondition failures (no connection, wrong
 * status), the post is left unchanged and no API call is made.
 */
export async function publishPostToMeta(
  db: Db,
  postId: string,
  deps: PublishDeps,
  attemptedBy: string
): Promise<PublishResult> {
  const post = await loadPostForPublish(db, postId)
  if (!post) return preconditionError("Post not found")
  if (post.status !== "approved") {
    return preconditionError(`Post is not approved (status=${post.status})`)
  }

  const connection = await getDecryptedConnectionByClient(db, post.clientId)
  if (!connection) {
    return preconditionError("Client has no Meta connection")
  }

  if (post.platform === "facebook") {
    return await publishFacebook(db, post, connection, deps, attemptedBy)
  }
  if (post.platform === "instagram") {
    return await publishInstagram(db, post, connection, deps, attemptedBy)
  }
  return preconditionError(`Platform ${post.platform} not supported`)
}

async function publishInstagram(
  db: Db,
  post: PostWithPhoto,
  connection: DecryptedConnection,
  deps: PublishDeps,
  attemptedBy: string
): Promise<PublishResult> {
  if (!post.photoUrl) {
    return preconditionError("Instagram posts require a photo")
  }
  if (!connection.instagramBusinessId) {
    return preconditionError("Client's Meta connection has no Instagram account")
  }

  const base = getGraphBaseUrl()
  const igId = connection.instagramBusinessId
  const totalStartedAt = Date.now()

  const containerParams = new URLSearchParams({
    access_token: connection.accessToken,
    image_url: post.photoUrl,
    caption: post.content,
  })
  const containerResponse = await metaFetch(
    `${base}/${igId}/media`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: containerParams.toString(),
    },
    deps.fetcher
  )

  if (!containerResponse.ok) {
    const classified = classifyMetaError({
      httpStatus: containerResponse.httpStatus,
      body: containerResponse.body,
    })
    return await recordFailure(
      db,
      post.id,
      attemptedBy,
      Date.now() - totalStartedAt,
      classified
    )
  }

  const containerBody = containerResponse.body as { id?: string }
  const containerId = containerBody?.id
  if (!containerId) {
    return await recordFailure(db, post.id, attemptedBy, Date.now() - totalStartedAt, {
      class: "content-rejected",
      code: null,
      message: "Instagram container step returned 2xx with no id",
    })
  }

  const publishParams = new URLSearchParams({
    access_token: connection.accessToken,
    creation_id: containerId,
  })
  const publishResponse = await metaFetch(
    `${base}/${igId}/media_publish`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: publishParams.toString(),
    },
    deps.fetcher
  )

  if (!publishResponse.ok) {
    const classified = classifyMetaError({
      httpStatus: publishResponse.httpStatus,
      body: publishResponse.body,
    })
    return await recordFailure(
      db,
      post.id,
      attemptedBy,
      Date.now() - totalStartedAt,
      classified
    )
  }

  const publishBody = publishResponse.body as { id?: string }
  const metaPostId = publishBody?.id
  if (!metaPostId) {
    return await recordFailure(db, post.id, attemptedBy, Date.now() - totalStartedAt, {
      class: "content-rejected",
      code: null,
      message: "Instagram publish step returned 2xx with no id",
    })
  }

  return await recordSuccess(
    db,
    post.id,
    attemptedBy,
    Date.now() - totalStartedAt,
    metaPostId,
    deps.now
  )
}

async function publishFacebook(
  db: Db,
  post: PostWithPhoto,
  connection: DecryptedConnection,
  deps: PublishDeps,
  attemptedBy: string
): Promise<PublishResult> {
  const base = getGraphBaseUrl()
  const useImage = post.photoUrl !== null
  const path = useImage ? "photos" : "feed"
  const url = `${base}/${connection.pageId}/${path}`

  const params = new URLSearchParams({
    access_token: connection.accessToken,
    message: post.content,
  })
  if (useImage && post.photoUrl) {
    params.set("url", post.photoUrl)
  }

  const response = await metaFetch(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
    deps.fetcher
  )

  if (response.ok) {
    const body = response.body as { id?: string }
    const metaPostId = body?.id ?? null
    if (!metaPostId) {
      return await recordFailure(db, post.id, attemptedBy, response.durationMs, {
        class: "content-rejected",
        code: null,
        message: "Meta returned 2xx with no post id",
      })
    }
    return await recordSuccess(db, post.id, attemptedBy, response.durationMs, metaPostId, deps.now)
  }

  const classified = classifyMetaError({
    httpStatus: response.httpStatus,
    body: response.body,
  })
  return await recordFailure(db, post.id, attemptedBy, response.durationMs, classified)
}

async function recordSuccess(
  db: Db,
  postId: string,
  attemptedBy: string,
  durationMs: number,
  metaPostId: string,
  now: Date
): Promise<PublishOk> {
  await db
    .update(schema.posts)
    .set({ status: "published", publishedAt: now, publishError: null, updatedAt: now })
    .where(and(eq(schema.posts.id, postId), eq(schema.posts.status, "approved")))
  await insertPublishAttempt(db, {
    postId,
    attemptedBy,
    success: true,
    metaPostId,
    requestDurationMs: durationMs,
  })
  return { ok: true, metaPostId }
}

async function recordFailure(
  db: Db,
  postId: string,
  attemptedBy: string,
  durationMs: number,
  classified: { class: MetaErrorClass; code: string | null; message: string }
): Promise<PublishErr> {
  await db
    .update(schema.posts)
    .set({ status: "failed", publishError: classified.message, updatedAt: new Date() })
    .where(eq(schema.posts.id, postId))
  await insertPublishAttempt(db, {
    postId,
    attemptedBy,
    success: false,
    errorClass: classified.class,
    errorCode: classified.code,
    errorMessage: classified.message,
    requestDurationMs: durationMs,
  })
  return {
    ok: false,
    errorClass: classified.class,
    errorCode: classified.code,
    errorMessage: classified.message,
  }
}
