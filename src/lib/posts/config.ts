/**
 * Maximum times a post can be rejected before flagging Stefan.
 * Enforced in application logic, not a DB constraint.
 */
export const MAX_REJECTIONS = 3

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
export type PostStatus = "draft" | "approved" | "rejected" | "published" | "failed"
