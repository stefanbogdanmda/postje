/**
 * Maximum times a post can be rejected before flagging Stefan.
 * Enforced in application logic, not a DB constraint.
 */
export const MAX_REJECTIONS = 3

/**
 * How many posting days per week a client gets, per the spec's "min 3, max 6
 * posts per week per active platform". One posting day produces one post per
 * platform, so N days = N posts per platform. Configurable per client; these
 * bounds clamp that value.
 */
export const MIN_POSTS_PER_WEEK = 3
export const MAX_POSTS_PER_WEEK = 6
export const DEFAULT_POSTS_PER_WEEK = 5

/** Clamp an arbitrary value into the allowed posts-per-week range. */
export function clampPostsPerWeek(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_POSTS_PER_WEEK
  return Math.min(MAX_POSTS_PER_WEEK, Math.max(MIN_POSTS_PER_WEEK, Math.round(value)))
}

/**
 * Default posting times by industry. Used to set publishAt when
 * a post is approved. Keys are lowercase industry strings matching
 * the clients table.
 *
 * Format: "HH:MM" in 24-hour local time.
 */
export const INDUSTRY_POST_TIMES: Record<string, string> = {
  cafe: "08:00",
  bakery: "07:00",
  restaurant: "11:00",
}

/** Fallback when no industry match is found. */
export const DEFAULT_POST_TIME = "09:00"

export type Platform = "instagram" | "facebook"
export type PostStatus =
  | "draft"
  | "approved"
  | "publishing"
  | "rejected"
  | "published"
  | "failed"
