// In-memory rate limiter.
// Tracks how many magic link requests each email has made recently.
// Counters reset if the server restarts — acceptable trade-off for simplicity.

const MAX_REQUESTS = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes

// Map from email address to list of request timestamps
const requestLog = new Map<string, number[]>()

export function isRateLimited(email: string): boolean {
  const now = Date.now()
  const normalizedEmail = email.toLowerCase()

  // Get existing timestamps, or empty array if first request
  const timestamps = requestLog.get(normalizedEmail) ?? []

  // Keep only timestamps within the current window
  const recentTimestamps = timestamps.filter((t) => now - t < WINDOW_MS)

  if (recentTimestamps.length >= MAX_REQUESTS) {
    // Update the stored timestamps (cleaned up) even when rate limited
    requestLog.set(normalizedEmail, recentTimestamps)
    return true
  }

  // Record this request
  recentTimestamps.push(now)
  requestLog.set(normalizedEmail, recentTimestamps)
  return false
}

export function isKeyRateLimited(
  key: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const now = Date.now()
  const timestamps = requestLog.get(key) ?? []
  const recentTimestamps = timestamps.filter((t) => now - t < windowMs)

  if (recentTimestamps.length >= maxRequests) {
    requestLog.set(key, recentTimestamps)
    return true
  }

  recentTimestamps.push(now)
  requestLog.set(key, recentTimestamps)
  return false
}
