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
