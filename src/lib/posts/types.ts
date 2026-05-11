import type { Platform, PostStatus } from "./config"

/** A post row as returned by the database. */
export interface Post {
  id: string
  clientId: string
  platform: Platform
  scheduledDate: string
  status: PostStatus
  content: string
  photoId: string | null
  photoUrl: string | null
  reasoning: string
  publishAt: Date | null
  rejectionCount: number
  approvedAt: Date | null
  rejectedAt: Date | null
  publishedAt: Date | null
  publishError: string | null
  firstSeenAt: Date | null
  alertedAt: Date | null
  regenLimitAlertedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** A day that has at least one approved/published/failed post — cannot be regenerated. */
export interface LockedDay {
  scheduledDate: string
  hasPhoto: boolean
}

/** Request body for POST /api/generate-posts */
export interface GeneratePostsRequest {
  clientId: string
  startDate: string
}

/** Response body from POST /api/generate-posts */
export interface GeneratePostsResponse {
  clientId: string
  startDate: string
  endDate: string
  generatedCount: number
  skippedLockedCount: number
}

/** Posts grouped by scheduled date for the GET endpoint response. */
export interface PostsByDay {
  scheduledDate: string
  posts: Post[]
}
