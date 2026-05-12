import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"

/** Any Postgres-dialect Drizzle database (Neon in prod, PGlite in tests). */
type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export type AttentionSignal =
  | "failed"
  | "overdue"
  | "stale"
  | "regen-limit"
  | "unseen"
  | "rejected"

export interface AttentionItem {
  signalType: AttentionSignal
  postId: string
  clientId: string
  businessName: string
  platform: "instagram" | "facebook"
  scheduledDate: string
  signalAt: Date
  contentPreview: string
}

export interface CalibrationItem {
  clientId: string
  businessName: string
  joinedAt: Date
  postCount: number
}

export interface AttentionData {
  failedPosts: AttentionItem[]
  overduePosts: AttentionItem[]
  staleDrafts: AttentionItem[]
  regenLimitHits: AttentionItem[]
  unseenDrafts: AttentionItem[]
  recentRejections: AttentionItem[]
  calibrationClients: CalibrationItem[]
}

const PREVIEW_LENGTH = 80

function preview(content: string): string {
  return content.length <= PREVIEW_LENGTH ? content : content.slice(0, PREVIEW_LENGTH)
}

export async function getAttentionData(_db: Db, _now: Date): Promise<AttentionData> {
  return {
    failedPosts: [],
    overduePosts: [],
    staleDrafts: [],
    regenLimitHits: [],
    unseenDrafts: [],
    recentRejections: [],
    calibrationClients: [],
  }
}

export const __internal = { preview }
