import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import type { PhotoAnalysis } from "@/lib/ai/types"

// ──────────────────────────────────────────────
// users — one row per person (clients and Stefan)
// ──────────────────────────────────────────────
export const users = pgTable("users", {
  id: text("id")
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role", { enum: ["client", "admin"] })
    .notNull()
    .default("client"),
  emailVerified: timestamp("emailVerified", { withTimezone: true, mode: "date" }),
  hasLoggedIn: boolean("hasLoggedIn").notNull().default(false),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
  image: text("image"),
})

// ──────────────────────────────────────────────
// clients — business profiles for client users
// ──────────────────────────────────────────────
export const clients = pgTable("clients", {
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
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
  timezone: text("timezone").notNull().default("Europe/Amsterdam"),
  toneOfVoice: text("toneOfVoice"),
  targetCustomers: text("targetCustomers"),
  brandPersonality: text("brandPersonality"),
  bannedPhrases: jsonb("bannedPhrases").$type<string[]>().notNull().default([]),
  examplePosts: jsonb("examplePosts").$type<string[]>().notNull().default([]),
  calibrationStartDate: timestamp("calibrationStartDate", { withTimezone: true, mode: "date" }),
  publishMode: text("publishMode", { enum: ["manual", "auto"] }).notNull().default("auto"),
})

// ──────────────────────────────────────────────
// photos — client photos for post generation
// ──────────────────────────────────────────────
export const photos = pgTable("photos", {
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
  analysis: jsonb("analysis").$type<PhotoAnalysis>(),
  analyzedAt: timestamp("analyzedAt", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
})

// ──────────────────────────────────────────────
// posts — generated social media posts
// ──────────────────────────────────────────────
export const posts = pgTable(
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
      enum: [
        "draft",
        "approved",
        "publishing",
        "rejected",
        "published",
        "failed",
      ],
    })
      .notNull()
      .default("draft"),
    content: text("content").notNull(),
    photoId: text("photoId").references(() => photos.id),
    reasoning: text("reasoning").notNull(),
    publishAt: timestamp("publishAt", { withTimezone: true, mode: "date" }),
    rejectionCount: integer("rejectionCount").notNull().default(0),
    approvedAt: timestamp("approvedAt", { withTimezone: true, mode: "date" }),
    rejectedAt: timestamp("rejectedAt", { withTimezone: true, mode: "date" }),
    publishedAt: timestamp("publishedAt", { withTimezone: true, mode: "date" }),
    publishError: text("publishError"),
    firstSeenAt: timestamp("firstSeenAt", { withTimezone: true, mode: "date" }),
    alertedAt: timestamp("alertedAt", { withTimezone: true, mode: "date" }),
    regenLimitAlertedAt: timestamp("regenLimitAlertedAt", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
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
// accounts — Auth.js requirement
// ──────────────────────────────────────────────
export const accounts = pgTable(
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
    expires_at: bigint("expires_at", { mode: "number" }),
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
export const sessions = pgTable("sessions", {
  sessionToken: text("sessionToken").notNull().primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
})

// ──────────────────────────────────────────────
// verificationTokens — magic link tokens (hashed)
// ──────────────────────────────────────────────
export const verificationTokens = pgTable(
  "verificationTokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull().unique(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })]
)

// ──────────────────────────────────────────────
// authThrottle — persistent rate-limit log for magic-link sends.
// One row per request attempt. Old rows are cleaned up inline on
// each call for the same key.
// ──────────────────────────────────────────────
export const authThrottle = pgTable(
  "auth_throttle",
  {
    id: text("id")
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    key: text("key").notNull(),
    requestedAt: timestamp("requestedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("auth_throttle_key_requestedAt_idx").on(t.key, t.requestedAt),
  ]
)

// ──────────────────────────────────────────────
// deletionRequests — scheduled account deletions with a cooling-off window.
// One active row per user; cron sweeps when scheduledFor <= now and
// cancelledAt IS NULL. cancelToken is the unguessable id used in the
// email cancel link.
// ──────────────────────────────────────────────
export const deletionRequests = pgTable(
  "deletion_requests",
  {
    id: text("id")
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    cancelToken: text("cancelToken").notNull().unique(),
    requestedAt: timestamp("requestedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
    scheduledFor: timestamp("scheduledFor", { withTimezone: true, mode: "date" })
      .notNull(),
    cancelledAt: timestamp("cancelledAt", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completedAt", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("deletion_requests_due_idx").on(t.scheduledFor),
  ]
)

// ──────────────────────────────────────────────
// deletionAuditLog — records of deleted accounts
// ──────────────────────────────────────────────
export const deletionAuditLog = pgTable("deletion_audit_log", {
  id: text("id")
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  deletedUserEmail: text("deletedUserEmail").notNull(),
  deletedUserId: text("deletedUserId").notNull(),
  deletedBy: text("deletedBy").notNull(),
  deletedAt: timestamp("deletedAt", { withTimezone: true, mode: "date" })
    .notNull()
    .$defaultFn(() => new Date()),
})

// ──────────────────────────────────────────────
// metaConnections — encrypted Meta page-access-token storage.
// One active row per client per page. The encrypted token is decoded
// only inside the publisher; nothing else reads it.
// ──────────────────────────────────────────────
export const metaConnections = pgTable(
  "meta_connections",
  {
    id: text("id")
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    clientId: text("clientId")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    pageId: text("pageId").notNull(),
    pageName: text("pageName").notNull(),
    instagramBusinessId: text("instagramBusinessId"),
    encryptedAccessToken: text("encryptedAccessToken").notNull(),
    grantedScopes: text("grantedScopes").notNull(),
    connectedAt: timestamp("connectedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastValidatedAt: timestamp("lastValidatedAt", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("meta_connections_client_page_idx").on(t.clientId, t.pageId),
  ]
)

// ──────────────────────────────────────────────
// publishAttempts — one row per Meta API publish attempt, success or fail.
// The full audit trail; posts.publishError is just the most-recent message
// denormalized for the queue display. Cascades on post delete.
// ──────────────────────────────────────────────
export const publishAttempts = pgTable(
  "publish_attempts",
  {
    id: text("id")
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    postId: text("postId")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    attemptedAt: timestamp("attemptedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
    attemptedBy: text("attemptedBy").notNull(),
    metaPostId: text("metaPostId"),
    success: boolean("success").notNull(),
    errorClass: text("errorClass", {
      enum: ["transient", "permanent-token", "permanent-content", "unknown"],
    }),
    errorCode: text("errorCode"),
    errorMessage: text("errorMessage"),
    requestDurationMs: integer("requestDurationMs"),
  },
  (t) => [index("publish_attempts_post_idx").on(t.postId)]
)


// ──────────────────────────────────────────────
// postFlags — client-reported issues on published posts.
// Flag button on published posts alerts Stefan immediately.
// ──────────────────────────────────────────────
export const postFlags = pgTable(
  "post_flags",
  {
    id: text("id")
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    postId: text("postId")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    clientId: text("clientId")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    reason: text("reason"),
    flaggedAt: timestamp("flaggedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: timestamp("resolvedAt", { withTimezone: true, mode: "date" }),
    resolvedBy: text("resolvedBy"),
  },
  (t) => [index("post_flags_post_idx").on(t.postId)]
)
