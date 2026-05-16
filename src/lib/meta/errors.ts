/** What we know about a failed Graph API call. */
export interface MetaApiError {
  /** HTTP status code from the response, or null for network/timeout errors. */
  httpStatus: number | null
  /** Parsed JSON body, or null if the response had no JSON. */
  body: unknown
}

export type MetaErrorClass = "transient" | "token-expired" | "content-rejected"

export interface ClassifiedError {
  class: MetaErrorClass
  /** Meta's `error.code` as a string, or null if not present. */
  code: string | null
  /** Best human-readable message we can derive. */
  message: string
}

interface MetaErrorBody {
  error?: {
    code?: number
    error_subcode?: number
    type?: string
    message?: string
  }
}

function parseErrorBody(body: unknown): MetaErrorBody["error"] | undefined {
  if (typeof body !== "object" || body === null) return undefined
  const maybe = (body as MetaErrorBody).error
  if (typeof maybe !== "object" || maybe === null) return undefined
  return maybe
}

/**
 * Classify a failed Meta API response into one of three retry classes.
 * Pure function — no I/O.
 */
export function classifyMetaError(err: MetaApiError): ClassifiedError {
  const { httpStatus, body } = err
  const metaError = parseErrorBody(body)
  const code = metaError?.code != null ? String(metaError.code) : null
  const message =
    metaError?.message ?? (httpStatus != null ? `HTTP ${httpStatus}` : "Network error")

  if (httpStatus === null) {
    return { class: "transient", code, message }
  }

  if (httpStatus >= 500 || httpStatus === 429) {
    return { class: "transient", code, message }
  }

  if (metaError?.code === 190 || metaError?.type === "OAuthException") {
    return { class: "token-expired", code, message }
  }

  return { class: "content-rejected", code, message }
}
