import {
  sqliteTable,
  text,
  integer,
  primaryKey,
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
