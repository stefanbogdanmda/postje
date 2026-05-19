export type ErrorClass =
  | "transient"
  | "permanent-token"
  | "permanent-content"
  | "unknown"

const TRANSIENT_CODES = new Set<number>([
  1, // API Unknown — retry
  2, // API Service — retry
  4, // App rate limit
  17, // User rate limit
  32, // Page rate limit
  613, // Rate limited / call-budget exhausted
])

const TOKEN_CODES = new Set<number>([
  190, // OAuthException — token expired or revoked
  200, // Permissions error (often re-grant is required)
  102, // Session has been invalidated
])

const CONTENT_CODES = new Set<number>([
  100, // Invalid parameter — usually the post content
  36003, // IG content policy rejection
  324, // Missing or invalid image file
  9004, // IG creative not found / unsupported
])

export function classifyMetaError(
  code: number | undefined,
  _subcode: number | undefined,
  status: number
): ErrorClass {
  if (status >= 500) return "transient"
  if (code !== undefined) {
    if (TRANSIENT_CODES.has(code)) return "transient"
    if (TOKEN_CODES.has(code)) return "permanent-token"
    if (CONTENT_CODES.has(code)) return "permanent-content"
  }
  return "unknown"
}
