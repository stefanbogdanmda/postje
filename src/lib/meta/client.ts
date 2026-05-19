export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

export class MetaApiError extends Error {
  readonly code: number | undefined
  readonly subcode: number | undefined
  readonly status: number
  constructor(message: string, status: number, code?: number, subcode?: number) {
    super(message)
    this.name = "MetaApiError"
    this.code = code
    this.subcode = subcode
    this.status = status
  }
}

/**
 * Read a Graph API JSON response. Throws MetaApiError on any non-2xx
 * status (with the graph error fields extracted) or on a non-JSON body.
 */
export async function readJsonOrThrow(res: Response): Promise<unknown> {
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new MetaApiError(
      `Graph API returned non-JSON (status ${res.status})`,
      res.status
    )
  }
  if (!res.ok) {
    const err = (body as {
      error?: { message?: string; code?: number; error_subcode?: number }
    })?.error
    throw new MetaApiError(
      err?.message ?? `Graph API error (status ${res.status})`,
      res.status,
      err?.code,
      err?.error_subcode
    )
  }
  return body
}
