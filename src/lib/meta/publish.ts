import { getGraphBaseUrl } from "./config"
import { readJsonOrThrow, type Fetcher } from "./client"

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
