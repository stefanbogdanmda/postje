export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

export interface MetaFetchOk {
  ok: true
  httpStatus: number
  body: unknown
  durationMs: number
}

export interface MetaFetchErr {
  ok: false
  httpStatus: number | null
  body: unknown
  durationMs: number
}

export type MetaFetchResult = MetaFetchOk | MetaFetchErr

const USER_AGENT = "social-ai/0.1 (+https://github.com/stefanbogdanmda/social-ai)"
const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Call the Meta Graph API. Always resolves — never throws — so callers
 * can branch cleanly on the result shape. The `fetcher` param is for
 * tests; production code calls `metaFetch(url, init)` and gets global fetch.
 */
export async function metaFetch(
  url: string,
  init: RequestInit = {},
  fetcher: Fetcher = fetch
): Promise<MetaFetchResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  const startedAt = Date.now()

  try {
    const response = await fetcher(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        ...(init.headers ?? {}),
      },
    })
    const durationMs = Date.now() - startedAt
    const body = await parseJsonSafe(response)

    if (response.ok) {
      return { ok: true, httpStatus: response.status, body, durationMs }
    }
    return { ok: false, httpStatus: response.status, body, durationMs }
  } catch {
    return {
      ok: false,
      httpStatus: null,
      body: null,
      durationMs: Date.now() - startedAt,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}
