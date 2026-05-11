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
      enum: ["draft", "approved", "rejected", "published", "failed"],
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
