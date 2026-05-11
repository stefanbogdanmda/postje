import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import type { PhotoAnalysis } from "@/lib/ai/types"

// ──────────────────────────────────────────────
// users — one row per person (clients and Stefan)
// ──────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: text("id")
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role", { enum: ["client", "admin"] })
    .notNull()
    .default("client"),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  hasLoggedIn: integer("hasLoggedIn", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  image: text("image"),
})

// ──────────────────────────────────────────────
// clients — business profiles for client users
// ──────────────────────────────────────────────
export const clients = sqliteTable("clients", {
  id: text("id")
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  businessName: text("businessName").notNull(),
  location: text("location"),
  industry: text("industry"),
  businessType: text("businessType"),
  productsServices: text("productsServices"),
  logoUrl: text("logoUrl"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})

// ──────────────────────────────────────────────
// photos — client photos for post generation
// ──────────────────────────────────────────────
export const photos = sqliteTable("photos", {
  id: text("id")
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  clientId: text("clientId")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  blobUrl: text("blobUrl").notNull(),
  originalFilename: text("originalFilename").notNull(),
  mimeType: text("mimeType").notNull(),
  sizeBytes: integer("sizeBytes").notNull(),
  analysis: text("analysis", { mode: "json" }).$type<PhotoAnalysis>(),
  analyzedAt: integer("analyzedAt", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})

// ──────────────────────────────────────────────
// posts — generated social media posts, one row per platform per day
// ──────────────────────────────────────────────
export const posts = sqliteTable(
  "posts",
  {
    id: text("id")
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    clientId: text("clientId")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["instagram", "facebook"] }).notNull(),
    scheduledDate: text("scheduledDate").notNull(),
    status: text("status", {
      enum: ["draft", "approved", "rejected", "published", "failed"],
    })
      .notNull()
      .default("draft"),
    content: text("content").notNull(),
    photoId: text("photoId").references(() => photos.id),
    reasoning: text("reasoning").notNull(),
    publishAt: integer("publishAt", { mode: "timestamp_ms" }),
    rejectionCount: integer("rejectionCount").notNull().default(0),
    approvedAt: integer("approvedAt", { mode: "timestamp_ms" }),
    rejectedAt: integer("rejectedAt", { mode: "timestamp_ms" }),
    publishedAt: integer("publishedAt", { mode: "timestamp_ms" }),
    publishError: text("publishError"),
    firstSeenAt: integer("firstSeenAt", { mode: "timestamp_ms" }),
    alertedAt: integer("alertedAt", { mode: "timestamp_ms" }),
    regenLimitAlertedAt: integer("regenLimitAlertedAt", { mode: "timestamp_ms" }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("posts_client_date_idx").on(t.clientId, t.scheduledDate),
    index("posts_status_publish_idx").on(t.status, t.publishAt),
    index("posts_stale_alert_idx").on(t.status, t.alertedAt, t.firstSeenAt),
    uniqueIndex("posts_client_date_platform_idx").on(
      t.clientId,
      t.scheduledDate,
      t.platform
    ),
  ]
)

// ──────────────────────────────────────────────
// accounts — Auth.js requirement, links users to auth providers
// ──────────────────────────────────────────────
export const accounts = sqliteTable(
  "accounts",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })]
)

// ──────────────────────────────────────────────
// sessions — tracks who is currently logged in
// ──────────────────────────────────────────────
export const sessions = sqliteTable("sessions", {
  sessionToken: text("sessionToken").notNull().primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
})

// ──────────────────────────────────────────────
// verificationTokens — magic link tokens (hashed)
// ──────────────────────────────────────────────
export const verificationTokens = sqliteTable(
  "verificationTokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull().unique(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })]
)

// ──────────────────────────────────────────────
// deletionAuditLog — records of deleted accounts
// ──────────────────────────────────────────────
export const deletionAuditLog = sqliteTable("deletion_audit_log", {
  id: text("id")
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  deletedUserEmail: text("deletedUserEmail").notNull(),
  deletedUserId: text("deletedUserId").notNull(),
  deletedBy: text("deletedBy").notNull(),
  deletedAt: integer("deletedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
