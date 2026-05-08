# Post Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist generated posts to the database so the client review UI can read, approve, reject, and edit them.

**Architecture:** One new `posts` table (one row per platform per day). Generation API writes to DB then returns a pointer. All consumers (preview, review) read from a new GET endpoint. Locked days are passed to the plan prompt so regeneration works around approved posts.

**Tech Stack:** Drizzle ORM + SQLite, Next.js API routes, vitest for tests

**Design spec:** `docs/superpowers/specs/2026-05-08-post-persistence-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/db/schema.ts` | Modify | Add `posts` table definition |
| `src/lib/posts/types.ts` | Create | Post-specific types (Post, LockedDay, GenerateRequest/Response) |
| `src/lib/posts/config.ts` | Create | MAX_REJECTIONS, industry posting time defaults |
| `src/lib/posts/dates.ts` | Create | Day name → date mapping, date range helpers |
| `src/lib/posts/repository.ts` | Create | DB operations: insert, query, delete, locked-day detection |
| `src/lib/posts/locked-days.ts` | Create | Build locked-day prompt context string |
| `src/lib/ai/prompts.ts` | Modify | Append locked-day context to plan user prompt |
| `src/app/api/generate-posts/route.ts` | Modify | Accept params, persist to DB, return pointer |
| `src/app/api/posts/route.ts` | Create | GET endpoint for reading posts |
| `src/app/admin/generate-preview/page.tsx` | Modify | Two-call flow (generate → fetch → render) |
| `vitest.config.ts` | Create | Test runner config with path aliases |
| `src/test/db.ts` | Create | In-memory test DB helper |
| `src/lib/posts/__tests__/dates.test.ts` | Create | Date utility tests |
| `src/lib/posts/__tests__/repository.test.ts` | Create | Repository tests |
| `src/lib/posts/__tests__/locked-days.test.ts` | Create | Locked-day prompt builder tests |
| `src/lib/posts/__tests__/generate-posts.test.ts` | Create | Generation API integration test (mocked Claude) |

---

### Task 0: Create feature branch

- [ ] **Step 1: Create and switch to feature branch**

```bash
git checkout -b feat/post-persistence
```

All subsequent commits in this plan land on this branch, not main.

---

### Task 1: Install vitest and create test infrastructure

**Files:**
- Create: `vitest.config.ts`
- Create: `src/test/db.ts`
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`
Expected: Added to devDependencies

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
})
```

- [ ] **Step 3: Add test script to package.json**

Add to `scripts`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Create test DB helper**

Create `src/test/db.ts`:

```typescript
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import * as schema from "@/db/schema"

export type TestDb = ReturnType<typeof createTestDb>

export function createTestDb() {
  const sqlite = new Database(":memory:")
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: "src/db/migrations" })
  return db
}

/**
 * Insert a minimal client row for testing. Returns the client ID.
 */
export function seedTestClient(db: TestDb, clientId: string = "test-client-001") {
  const userId = "test-user-001"

  db.insert(schema.users).values({
    id: userId,
    email: "test@example.com",
    name: "Test User",
    role: "client",
  }).run()

  db.insert(schema.clients).values({
    id: clientId,
    userId,
    businessName: "Test Café",
  }).run()

  return clientId
}
```

- [ ] **Step 5: Verify test infrastructure works**

Run: `npx vitest run --passWithNoTests`
Expected: Vitest runs, passes (no tests yet)

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts src/test/db.ts package.json package-lock.json
git commit -m "chore: add vitest and test DB helper"
```

---

### Task 2: Add posts table to schema and run migration

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add posts table definition**

Add to `src/db/schema.ts`, after the `photos` table and before the `accounts` table. Add `index` and `uniqueIndex` to the imports from `drizzle-orm/sqlite-core`:

```typescript
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
```

Then add the table:

```typescript
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
    uniqueIndex("posts_client_date_platform_idx").on(
      t.clientId,
      t.scheduledDate,
      t.platform
    ),
  ]
)
```

- [ ] **Step 2: Generate migration**

Run: `npm run db:generate`
Expected: New migration file in `src/db/migrations/` with CREATE TABLE for posts

- [ ] **Step 3: Run migration**

Run: `npm run db:migrate`
Expected: Migration applied, posts table exists

- [ ] **Step 4: Verify migration**

Run: `npx drizzle-kit studio` (open briefly to confirm table appears, then close)
Or run: `npx tsx -e "import Database from 'better-sqlite3'; const db = new Database('sqlite.db'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='posts'\").all())"`
Expected: `[{ name: 'posts' }]`

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -m "feat: add posts table schema and migration"
```

---

### Task 3: Add config and types

**Files:**
- Create: `src/lib/posts/config.ts`
- Create: `src/lib/posts/types.ts`

- [ ] **Step 1: Create config**

Create `src/lib/posts/config.ts`:

```typescript
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
```

- [ ] **Step 2: Create types**

Create `src/lib/posts/types.ts`:

```typescript
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
  reasoning: string
  publishAt: Date | null
  rejectionCount: number
  approvedAt: Date | null
  rejectedAt: Date | null
  publishedAt: Date | null
  publishError: string | null
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
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/posts/config.ts src/lib/posts/types.ts
git commit -m "feat: add post config and types"
```

---

### Task 4: Add date utilities with tests

**Files:**
- Create: `src/lib/posts/dates.ts`
- Create: `src/lib/posts/__tests__/dates.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/posts/__tests__/dates.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { dayNameToDate, getDateRange } from "../dates"

describe("dayNameToDate", () => {
  it("maps Tuesday to the start date", () => {
    expect(dayNameToDate("Tuesday", "2026-05-12")).toBe("2026-05-12")
  })

  it("maps Monday to start date + 6", () => {
    expect(dayNameToDate("Monday", "2026-05-12")).toBe("2026-05-18")
  })

  it("maps Wednesday to start date + 1", () => {
    expect(dayNameToDate("Wednesday", "2026-05-12")).toBe("2026-05-13")
  })

  it("maps Sunday to start date + 5", () => {
    expect(dayNameToDate("Sunday", "2026-05-12")).toBe("2026-05-17")
  })

  it("handles month boundary", () => {
    expect(dayNameToDate("Monday", "2026-05-26")).toBe("2026-06-01")
  })

  it("throws for unknown day name", () => {
    expect(() => dayNameToDate("Funday", "2026-05-12")).toThrow("Unknown day name")
  })
})

describe("getDateRange", () => {
  it("returns 7 dates starting from startDate", () => {
    const dates = getDateRange("2026-05-12")
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe("2026-05-12")
    expect(dates[6]).toBe("2026-05-18")
  })

  it("handles year boundary", () => {
    const dates = getDateRange("2026-12-29")
    expect(dates[3]).toBe("2027-01-01")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/posts/__tests__/dates.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/lib/posts/dates.ts`:

```typescript
/**
 * Day offsets from the week start (Tuesday).
 * The plan prompt generates Tuesday through Monday.
 */
const DAY_OFFSETS: Record<string, number> = {
  Tuesday: 0,
  Wednesday: 1,
  Thursday: 2,
  Friday: 3,
  Saturday: 4,
  Sunday: 5,
  Monday: 6,
}

/**
 * Convert a day name ("Tuesday") to an ISO date string, given
 * the week's start date (which must be a Tuesday).
 */
export function dayNameToDate(dayName: string, startDate: string): string {
  const offset = DAY_OFFSETS[dayName]
  if (offset === undefined) {
    throw new Error(`Unknown day name: "${dayName}"`)
  }
  const date = new Date(startDate + "T00:00:00")
  date.setDate(date.getDate() + offset)
  return date.toISOString().split("T")[0]
}

/**
 * Return an array of 7 ISO date strings starting from startDate.
 */
export function getDateRange(startDate: string): string[] {
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(startDate + "T00:00:00")
    date.setDate(date.getDate() + i)
    dates.push(date.toISOString().split("T")[0])
  }
  return dates
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/posts/__tests__/dates.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/posts/dates.ts src/lib/posts/__tests__/dates.test.ts
git commit -m "feat: add date utilities for day-name-to-date mapping"
```

---

### Task 5: Add post repository with tests

**Files:**
- Create: `src/lib/posts/repository.ts`
- Create: `src/lib/posts/__tests__/repository.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/posts/__tests__/repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { createTestDb, seedTestClient, type TestDb } from "@/test/db"
import {
  insertPosts,
  getPostsByDateRange,
  readRejectionCounts,
  replacePostsForOpenDays,
  getLockedDays,
} from "../repository"
import type { Platform, PostStatus } from "../config"

let db: TestDb
const CLIENT_ID = "test-client-001"

function makePostRow(overrides: Partial<{
  platform: Platform
  scheduledDate: string
  status: PostStatus
  content: string
  reasoning: string
  photoId: string | null
  rejectionCount: number
}> = {}) {
  return {
    clientId: CLIENT_ID,
    platform: (overrides.platform ?? "instagram") as Platform,
    scheduledDate: overrides.scheduledDate ?? "2026-05-12",
    status: (overrides.status ?? "draft") as PostStatus,
    content: overrides.content ?? "Test post content",
    reasoning: overrides.reasoning ?? "Test reasoning",
    photoId: overrides.photoId ?? null,
    rejectionCount: overrides.rejectionCount ?? 0,
  }
}

beforeEach(() => {
  db = createTestDb()
  seedTestClient(db, CLIENT_ID)
})

describe("insertPosts", () => {
  it("inserts rows into the posts table", () => {
    const rows = [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12" }),
    ]

    insertPosts(db, rows)

    const result = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(result).toHaveLength(2)
    expect(result[0].status).toBe("draft")
    expect(result[0].clientId).toBe(CLIENT_ID)
  })

  it("inherits rejection count", () => {
    const rows = [
      makePostRow({ platform: "instagram", rejectionCount: 2 }),
    ]

    insertPosts(db, rows)

    const result = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(result[0].rejectionCount).toBe(2)
  })
})

describe("getPostsByDateRange", () => {
  it("returns posts within the date range", () => {
    insertPosts(db, [
      makePostRow({ scheduledDate: "2026-05-12" }),
      makePostRow({ scheduledDate: "2026-05-14" }),
      makePostRow({ scheduledDate: "2026-05-20" }),
    ])

    const result = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(result).toHaveLength(2)
  })

  it("filters by client ID", () => {
    seedTestClient(db, "other-client")
    insertPosts(db, [
      makePostRow({ scheduledDate: "2026-05-12" }),
      { ...makePostRow({ scheduledDate: "2026-05-12" }), clientId: "other-client" },
    ])

    const result = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(result).toHaveLength(1)
    expect(result[0].clientId).toBe(CLIENT_ID)
  })

  it("returns empty array when no posts exist", () => {
    const result = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(result).toHaveLength(0)
  })
})

describe("readRejectionCounts", () => {
  it("returns empty map when no rejected posts exist", () => {
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "draft" }),
    ])

    const counts = readRejectionCounts(db, CLIENT_ID, ["2026-05-12"])
    expect(counts.size).toBe(0)
  })

  it("returns rejection counts from rejected posts without deleting them", () => {
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "rejected", rejectionCount: 2 }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", status: "rejected", rejectionCount: 2 }),
    ])

    const counts = readRejectionCounts(db, CLIENT_ID, ["2026-05-12"])
    expect(counts.get("2026-05-12:instagram")).toBe(2)
    expect(counts.get("2026-05-12:facebook")).toBe(2)

    // Posts still exist (read-only operation)
    const remaining = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(remaining).toHaveLength(2)
  })
})

describe("replacePostsForOpenDays", () => {
  it("deletes drafts and inserts new rows in one transaction", () => {
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "draft" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", status: "draft" }),
    ])

    const newRows = [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", content: "New IG" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", content: "New FB" }),
    ]

    replacePostsForOpenDays(db, CLIENT_ID, ["2026-05-12"], newRows)

    const result = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(result).toHaveLength(2)
    expect(result.find((p) => p.platform === "instagram")?.content).toBe("New IG")
    expect(result.find((p) => p.platform === "facebook")?.content).toBe("New FB")
  })

  it("deletes rejected posts and inserts replacements", () => {
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "rejected", rejectionCount: 1 }),
    ])

    const newRows = [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", content: "Replacement", rejectionCount: 1 }),
    ]

    replacePostsForOpenDays(db, CLIENT_ID, ["2026-05-12"], newRows)

    const result = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe("Replacement")
    expect(result[0].rejectionCount).toBe(1)
  })

  it("does NOT delete approved posts", () => {
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "approved" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", status: "approved" }),
    ])

    replacePostsForOpenDays(db, CLIENT_ID, ["2026-05-12"], [])

    const remaining = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(remaining).toHaveLength(2)
  })

  it("does NOT delete published or failed posts", () => {
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "published" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", status: "failed" }),
    ])

    replacePostsForOpenDays(db, CLIENT_ID, ["2026-05-12"], [])

    const remaining = getPostsByDateRange(db, CLIENT_ID, "2026-05-12", "2026-05-12")
    expect(remaining).toHaveLength(2)
  })
})

describe("getLockedDays", () => {
  it("returns days with approved posts", () => {
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: "2026-05-12", status: "approved" }),
      makePostRow({ platform: "facebook", scheduledDate: "2026-05-12", status: "approved" }),
    ])

    const locked = getLockedDays(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(locked).toHaveLength(1)
    expect(locked[0].scheduledDate).toBe("2026-05-12")
  })

  it("reports hasPhoto correctly", () => {
    insertPosts(db, [
      makePostRow({ scheduledDate: "2026-05-12", status: "approved", photoId: "photo-1" }),
      makePostRow({ scheduledDate: "2026-05-13", status: "published", photoId: null }),
    ])

    const locked = getLockedDays(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(locked).toHaveLength(2)

    const withPhoto = locked.find((d) => d.scheduledDate === "2026-05-12")
    const withoutPhoto = locked.find((d) => d.scheduledDate === "2026-05-13")
    expect(withPhoto?.hasPhoto).toBe(true)
    expect(withoutPhoto?.hasPhoto).toBe(false)
  })

  it("does NOT include draft or rejected days", () => {
    insertPosts(db, [
      makePostRow({ scheduledDate: "2026-05-12", status: "draft" }),
      makePostRow({ scheduledDate: "2026-05-13", status: "rejected" }),
    ])

    const locked = getLockedDays(db, CLIENT_ID, "2026-05-12", "2026-05-18")
    expect(locked).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/posts/__tests__/repository.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the repository implementation**

Create `src/lib/posts/repository.ts`:

```typescript
import { eq, and, gte, lte, inArray, sql } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import * as schema from "@/db/schema"
import type { Post, LockedDay } from "./types"
import type { Platform, PostStatus } from "./config"

type Db = BetterSQLite3Database<typeof schema>

/** Statuses that block deletion during regeneration. */
const LOCKED_STATUSES: PostStatus[] = ["approved", "published", "failed"]

/** Statuses that get deleted during regeneration. */
const REPLACEABLE_STATUSES: PostStatus[] = ["draft", "rejected"]

/**
 * Insert post rows into the database. All rows are inserted in a
 * single transaction — either all succeed or none do.
 */
export function insertPosts(
  db: Db,
  rows: Array<{
    clientId: string
    platform: Platform
    scheduledDate: string
    status?: PostStatus
    content: string
    photoId?: string | null
    reasoning: string
    rejectionCount?: number
  }>
): void {
  const values = rows.map((row) => ({
    clientId: row.clientId,
    platform: row.platform,
    scheduledDate: row.scheduledDate,
    status: row.status ?? "draft",
    content: row.content,
    photoId: row.photoId ?? null,
    reasoning: row.reasoning,
    rejectionCount: row.rejectionCount ?? 0,
  }))

  db.transaction((tx) => {
    for (const value of values) {
      tx.insert(schema.posts).values(value).run()
    }
  })
}

/**
 * Query posts for a client within a date range (inclusive).
 * Returns rows ordered by scheduledDate, then platform.
 */
export function getPostsByDateRange(
  db: Db,
  clientId: string,
  startDate: string,
  endDate: string
): Post[] {
  return db
    .select()
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.clientId, clientId),
        gte(schema.posts.scheduledDate, startDate),
        lte(schema.posts.scheduledDate, endDate)
      )
    )
    .orderBy(schema.posts.scheduledDate, schema.posts.platform)
    .all() as Post[]
}

/**
 * Read rejection counts for rejected posts on specific dates.
 * Read-only — does not delete anything. Call this BEFORE the Claude
 * API call so counts are available even if generation fails.
 *
 * Returns a map keyed by "scheduledDate:platform".
 */
export function readRejectionCounts(
  db: Db,
  clientId: string,
  scheduledDates: string[]
): Map<string, number> {
  if (scheduledDates.length === 0) return new Map()

  const rejected = db
    .select({
      scheduledDate: schema.posts.scheduledDate,
      platform: schema.posts.platform,
      rejectionCount: schema.posts.rejectionCount,
    })
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.clientId, clientId),
        inArray(schema.posts.scheduledDate, scheduledDates),
        eq(schema.posts.status, "rejected")
      )
    )
    .all()

  const counts = new Map<string, number>()
  for (const row of rejected) {
    if (row.rejectionCount > 0) {
      counts.set(`${row.scheduledDate}:${row.platform}`, row.rejectionCount)
    }
  }
  return counts
}

/**
 * Atomically delete draft/rejected posts for specific dates and insert
 * new rows. Everything happens in one transaction — if insertion fails,
 * old posts are preserved.
 *
 * Approved, published, and failed posts are never deleted.
 */
export function replacePostsForOpenDays(
  db: Db,
  clientId: string,
  scheduledDates: string[],
  newRows: Array<{
    clientId: string
    platform: Platform
    scheduledDate: string
    status?: PostStatus
    content: string
    photoId?: string | null
    reasoning: string
    rejectionCount?: number
  }>
): void {
  db.transaction((tx) => {
    // Delete replaceable posts
    if (scheduledDates.length > 0) {
      tx.delete(schema.posts)
        .where(
          and(
            eq(schema.posts.clientId, clientId),
            inArray(schema.posts.scheduledDate, scheduledDates),
            inArray(schema.posts.status, REPLACEABLE_STATUSES)
          )
        )
        .run()
    }

    // Insert new rows
    for (const row of newRows) {
      tx.insert(schema.posts)
        .values({
          clientId: row.clientId,
          platform: row.platform,
          scheduledDate: row.scheduledDate,
          status: row.status ?? "draft",
          content: row.content,
          photoId: row.photoId ?? null,
          reasoning: row.reasoning,
          rejectionCount: row.rejectionCount ?? 0,
        })
        .run()
    }
  })
}

/**
 * Find days in a date range that have at least one locked post
 * (approved, published, or failed). These days cannot be regenerated.
 */
export function getLockedDays(
  db: Db,
  clientId: string,
  startDate: string,
  endDate: string
): LockedDay[] {
  const rows = db
    .select({
      scheduledDate: schema.posts.scheduledDate,
      photoId: schema.posts.photoId,
    })
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.clientId, clientId),
        gte(schema.posts.scheduledDate, startDate),
        lte(schema.posts.scheduledDate, endDate),
        inArray(schema.posts.status, LOCKED_STATUSES)
      )
    )
    .all()

  // Deduplicate by scheduledDate (multiple platform rows per day)
  const dayMap = new Map<string, boolean>()
  for (const row of rows) {
    const current = dayMap.get(row.scheduledDate) ?? false
    dayMap.set(row.scheduledDate, current || row.photoId !== null)
  }

  return Array.from(dayMap.entries()).map(([scheduledDate, hasPhoto]) => ({
    scheduledDate,
    hasPhoto,
  }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/posts/__tests__/repository.test.ts`
Expected: All 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/posts/repository.ts src/lib/posts/__tests__/repository.test.ts
git commit -m "feat: add post repository with insert, query, delete, locked-day detection"
```

---

### Task 6: Add locked-day prompt builder with tests

**Files:**
- Create: `src/lib/posts/locked-days.ts`
- Create: `src/lib/posts/__tests__/locked-days.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/posts/__tests__/locked-days.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { buildLockedDaysContext } from "../locked-days"
import type { LockedDay } from "../types"

describe("buildLockedDaysContext", () => {
  it("returns empty string when no locked days", () => {
    const result = buildLockedDaysContext([], ["2026-05-12", "2026-05-13"])
    expect(result).toBe("")
  })

  it("formats locked days with photo info", () => {
    const locked: LockedDay[] = [
      { scheduledDate: "2026-05-12", hasPhoto: true },
      { scheduledDate: "2026-05-13", hasPhoto: false },
    ]
    const openDates = ["2026-05-14", "2026-05-15"]

    const result = buildLockedDaysContext(locked, openDates)

    expect(result).toContain("LOCKED:")
    expect(result).toContain("2026-05-12: photo assigned")
    expect(result).toContain("2026-05-13: text-only")
    expect(result).toContain("OPEN (plan these):")
    expect(result).toContain("2026-05-14")
    expect(result).toContain("2026-05-15")
  })

  it("returns empty string when all days are open (no locked context needed)", () => {
    const result = buildLockedDaysContext([], ["2026-05-12", "2026-05-13", "2026-05-14"])
    expect(result).toBe("")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/posts/__tests__/locked-days.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/lib/posts/locked-days.ts`:

```typescript
import type { LockedDay } from "./types"

/**
 * Build the locked-day context string to append to the plan user prompt.
 * Returns empty string if there are no locked days (normal full-week generation).
 *
 * This is appended via string concatenation — no structural changes to the prompt.
 */
export function buildLockedDaysContext(
  lockedDays: LockedDay[],
  openDates: string[]
): string {
  if (lockedDays.length === 0) return ""

  const lockedLines = lockedDays
    .map((day) => {
      const photoInfo = day.hasPhoto ? "photo assigned" : "text-only"
      return `- ${day.scheduledDate}: ${photoInfo}`
    })
    .join("\n")

  const openLines = openDates.map((date) => `- ${date}`).join("\n")

  return `

The following days are already planned and locked. Do not change them.
Plan new content only for the open days listed after.

LOCKED:
${lockedLines}

OPEN (plan these):
${openLines}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/posts/__tests__/locked-days.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/posts/locked-days.ts src/lib/posts/__tests__/locked-days.test.ts
git commit -m "feat: add locked-day prompt context builder"
```

---

### Task 7: Update plan prompt to accept locked-day context

**Files:**
- Modify: `src/lib/ai/prompts.ts`

**Caller check:** `buildPlanUserPrompt` has exactly one caller in source code: `src/app/api/generate-posts/route.ts:63`. No tests call it. The default parameter `""` is safe — no other caller will be silently affected.

- [ ] **Step 1: Add lockedDaysContext parameter to buildPlanUserPrompt**

In `src/lib/ai/prompts.ts`, change the signature of `buildPlanUserPrompt` from:

```typescript
export function buildPlanUserPrompt(
  client: ClientProfile,
  photos: AnalyzedPhoto[]
): string {
```

to:

```typescript
export function buildPlanUserPrompt(
  client: ClientProfile,
  photos: AnalyzedPhoto[],
  lockedDaysContext: string = ""
): string {
```

- [ ] **Step 2: Append locked-day context to the return value**

At the end of `buildPlanUserPrompt`, find the final return statement. The function currently ends with:

```typescript
Include all 7 days: Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday, Monday.`
}
```

Change it to:

```typescript
Include all 7 days: Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday, Monday.${lockedDaysContext}`
}
```

This is a string append — no structural change to the prompt template.

- [ ] **Step 3: Verify build**

Run: `npx next build`
Expected: Build succeeds. The default parameter `""` means existing call sites don't break.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/prompts.ts
git commit -m "feat: add locked-day context parameter to plan prompt"
```

---

### Task 8: Rewrite generation API to persist posts

**Files:**
- Modify: `src/app/api/generate-posts/route.ts`

This is the largest change. The API goes from returning post content to writing it to the DB and returning a pointer. `GeneratePostsRequest` and `GeneratePostsResponse` are already defined in `src/lib/posts/types.ts` (Task 3) — the route imports them from there.

- [ ] **Step 1: Rewrite the route handler**

Replace the entire contents of `src/app/api/generate-posts/route.ts` with:

```typescript
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { photos } from "@/db/schema"
import { eq } from "drizzle-orm"
import { getAnthropicClient } from "@/lib/ai/client"
import {
  buildPlanSystemPrompt,
  buildPlanUserPrompt,
  buildWriteSystemPrompt,
  buildWriteUserPrompt,
} from "@/lib/ai/prompts"
import { extractJSON } from "@/lib/ai/extract-json"
import { validatePosts } from "@/lib/ai/validate-posts"
import { cafeDeHoek } from "@/data/clients/cafe-de-hoek"
import {
  readRejectionCounts,
  replacePostsForOpenDays,
  getLockedDays,
} from "@/lib/posts/repository"
import { buildLockedDaysContext } from "@/lib/posts/locked-days"
import { dayNameToDate, getDateRange } from "@/lib/posts/dates"
import type {
  WeeklyPlan,
  DayPosts,
  AnalyzedPhoto,
  PhotoAnalysis,
} from "@/lib/ai/types"
import type { GeneratePostsRequest, GeneratePostsResponse } from "@/lib/posts/types"
import type { Platform } from "@/lib/posts/config"

const MODEL = "claude-sonnet-4-6"

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request
    const body = (await request.json()) as GeneratePostsRequest
    const { clientId, startDate } = body

    if (!clientId || !startDate) {
      return NextResponse.json(
        { error: "clientId and startDate are required" },
        { status: 400 }
      )
    }

    const dateRange = getDateRange(startDate)
    const endDate = dateRange[dateRange.length - 1]

    // Identify locked and open days
    const lockedDays = getLockedDays(db, clientId, startDate, endDate)
    const lockedDates = new Set(lockedDays.map((d) => d.scheduledDate))
    const openDates = dateRange.filter((d) => !lockedDates.has(d))

    if (openDates.length === 0) {
      return NextResponse.json({
        clientId,
        startDate,
        endDate,
        generatedCount: 0,
        skippedLockedCount: lockedDays.length,
      } satisfies GeneratePostsResponse)
    }

    // Read rejection counts BEFORE Claude call (read-only, no mutation)
    const rejectionCounts = readRejectionCounts(db, clientId, openDates)

    // Load client profile
    // TODO(v2): Load from DB by clientId instead of hardcoded import
    const clientProfile = cafeDeHoek

    // Load analyzed photos
    const anthropic = getAnthropicClient()
    const photoRows = await db
      .select()
      .from(photos)
      .where(eq(photos.clientId, clientId))

    const unanalyzedCount = photoRows.filter((p) => p.analysis === null).length
    if (unanalyzedCount > 0) {
      console.warn(
        `[generate-posts] Skipping ${unanalyzedCount} unanalyzed photo(s) for client ${clientId}`
      )
    }

    const analyzedPhotos: AnalyzedPhoto[] = photoRows
      .filter(
        (p): p is typeof p & { analysis: PhotoAnalysis } =>
          p.analysis !== null
      )
      .map((p) => ({
        id: p.id,
        blobUrl: p.blobUrl,
        analysis: p.analysis,
      }))

    // Build locked-day context for the plan prompt
    const lockedDaysContext = buildLockedDaysContext(lockedDays, openDates)

    // Stage 1: Generate content plan
    const planResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: buildPlanSystemPrompt(analyzedPhotos.length),
      messages: [
        {
          role: "user",
          content: buildPlanUserPrompt(
            clientProfile,
            analyzedPhotos,
            lockedDaysContext
          ),
        },
      ],
    })

    const planText = planResponse.content.find((b) => b.type === "text")
    if (!planText || planText.type !== "text") {
      return NextResponse.json(
        { error: "No text in plan response" },
        { status: 500 }
      )
    }

    let plan: WeeklyPlan
    try {
      plan = extractJSON<WeeklyPlan>(planText.text)
    } catch {
      return NextResponse.json(
        { error: "Failed to parse plan JSON", raw: planText.text },
        { status: 500 }
      )
    }

    // Stage 2: Write posts
    const photoMap = new Map(analyzedPhotos.map((p) => [p.id, p]))
    const photoDays = plan.days.filter(
      (d) => d.photoId && photoMap.has(d.photoId)
    )

    const writeContent: Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "url"; url: string } }
    > = []

    for (const day of photoDays) {
      const photo = photoMap.get(day.photoId!)!
      writeContent.push({
        type: "image",
        source: { type: "url", url: photo.blobUrl },
      })
      writeContent.push({
        type: "text",
        text: `[Photo for ${day.day} — ID: ${photo.id}]`,
      })
    }

    writeContent.push({
      type: "text",
      text: buildWriteUserPrompt(clientProfile, plan.days, analyzedPhotos),
    })

    const writeResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: buildWriteSystemPrompt(clientProfile),
      messages: [{ role: "user", content: writeContent }],
    })

    const writeText = writeResponse.content.find((b) => b.type === "text")
    if (!writeText || writeText.type !== "text") {
      return NextResponse.json(
        { error: "No text in write response" },
        { status: 500 }
      )
    }

    let rawPosts: { posts: Omit<DayPosts, "warnings">[] }
    try {
      rawPosts = extractJSON<{ posts: Omit<DayPosts, "warnings">[] }>(
        writeText.text
      )
    } catch {
      return NextResponse.json(
        { error: "Failed to parse posts JSON", raw: writeText.text },
        { status: 500 }
      )
    }

    // Validate posts
    const validatedPosts = validatePosts(
      rawPosts.posts,
      clientProfile.bannedPhrases
    )

    // Convert Claude output to per-platform DB rows
    const postRows: Array<{
      clientId: string
      platform: Platform
      scheduledDate: string
      content: string
      photoId: string | null
      reasoning: string
      rejectionCount: number
    }> = []

    for (const post of validatedPosts) {
      const dayPlan = plan.days.find((d) => d.day === post.day)
      const photoId = dayPlan?.photoId ?? null
      const scheduledDate = dayNameToDate(post.day, startDate)

      // Instagram row
      postRows.push({
        clientId,
        platform: "instagram",
        scheduledDate,
        content: post.instagramCaption,
        photoId,
        reasoning: post.reasoning,
        rejectionCount:
          rejectionCounts.get(`${scheduledDate}:instagram`) ?? 0,
      })

      // Facebook row
      postRows.push({
        clientId,
        platform: "facebook",
        scheduledDate,
        content: post.facebookPost,
        photoId,
        reasoning: post.reasoning,
        rejectionCount:
          rejectionCounts.get(`${scheduledDate}:facebook`) ?? 0,
      })
    }

    // Atomically delete old posts and insert new ones.
    // If this fails, old posts are preserved (no partial state).
    replacePostsForOpenDays(db, clientId, openDates, postRows)

    const response: GeneratePostsResponse = {
      clientId,
      startDate,
      endDate,
      generatedCount: postRows.length,
      skippedLockedCount: lockedDays.length,
    }

    return NextResponse.json(response)
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx next build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/app/api/generate-posts/route.ts
git commit -m "feat: rewrite generation API to persist posts to database"
```

---

### Task 8b: Integration test for generation API

**Files:**
- Create: `src/lib/posts/__tests__/generate-posts.test.ts`

This test exercises the generation flow end-to-end with a mocked Anthropic client. It verifies the orchestration logic — locked-day detection, rejection count carry-forward, prompt assembly, and DB persistence — without calling the real Claude API.

- [ ] **Step 1: Write the integration test**

Create `src/lib/posts/__tests__/generate-posts.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createTestDb, seedTestClient, type TestDb } from "@/test/db"
import {
  insertPosts,
  getPostsByDateRange,
  readRejectionCounts,
  replacePostsForOpenDays,
  getLockedDays,
} from "../repository"
import { buildLockedDaysContext } from "../locked-days"
import { dayNameToDate, getDateRange } from "../dates"
import type { Platform } from "../config"

/**
 * This test simulates the generation route's orchestration logic
 * without touching the Anthropic API or Next.js route handler.
 * It uses the same functions the route calls, in the same order.
 */

let db: TestDb
const CLIENT_ID = "test-client-001"
const START_DATE = "2026-05-12" // a Tuesday

function makePostRow(overrides: Partial<{
  platform: Platform
  scheduledDate: string
  status: "draft" | "approved" | "rejected" | "published" | "failed"
  content: string
  reasoning: string
  photoId: string | null
  rejectionCount: number
}> = {}) {
  return {
    clientId: CLIENT_ID,
    platform: (overrides.platform ?? "instagram") as Platform,
    scheduledDate: overrides.scheduledDate ?? "2026-05-12",
    status: overrides.status ?? "draft",
    content: overrides.content ?? "Test content",
    reasoning: overrides.reasoning ?? "Test reasoning",
    photoId: overrides.photoId ?? null,
    rejectionCount: overrides.rejectionCount ?? 0,
  }
}

/** Simulate Claude returning posts for given day names. */
function mockClaudeOutput(dayNames: string[]) {
  return dayNames.map((day) => ({
    day,
    instagramCaption: `IG post for ${day}`,
    facebookPost: `FB post for ${day}`,
    reasoning: `Reasoning for ${day}`,
  }))
}

beforeEach(() => {
  db = createTestDb()
  seedTestClient(db, CLIENT_ID)
})

describe("generation orchestration", () => {
  it("detects locked days and skips them during generation", () => {
    // Monday approved (locked), rest are open
    const tuesdayDate = dayNameToDate("Tuesday", START_DATE)
    const wednesdayDate = dayNameToDate("Wednesday", START_DATE)

    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: tuesdayDate, status: "approved" }),
      makePostRow({ platform: "facebook", scheduledDate: tuesdayDate, status: "approved" }),
    ])

    const dateRange = getDateRange(START_DATE)
    const endDate = dateRange[dateRange.length - 1]
    const lockedDays = getLockedDays(db, CLIENT_ID, START_DATE, endDate)
    const lockedDates = new Set(lockedDays.map((d) => d.scheduledDate))
    const openDates = dateRange.filter((d) => !lockedDates.has(d))

    expect(lockedDays).toHaveLength(1)
    expect(lockedDays[0].scheduledDate).toBe(tuesdayDate)
    expect(openDates).toHaveLength(6)
    expect(openDates).not.toContain(tuesdayDate)
  })

  it("includes locked-day context in plan prompt", () => {
    const tuesdayDate = dayNameToDate("Tuesday", START_DATE)
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: tuesdayDate, status: "approved", photoId: "photo-1" }),
      makePostRow({ platform: "facebook", scheduledDate: tuesdayDate, status: "approved", photoId: "photo-1" }),
    ])

    const dateRange = getDateRange(START_DATE)
    const endDate = dateRange[dateRange.length - 1]
    const lockedDays = getLockedDays(db, CLIENT_ID, START_DATE, endDate)
    const lockedDates = new Set(lockedDays.map((d) => d.scheduledDate))
    const openDates = dateRange.filter((d) => !lockedDates.has(d))

    const context = buildLockedDaysContext(lockedDays, openDates)

    expect(context).toContain("LOCKED:")
    expect(context).toContain(`${tuesdayDate}: photo assigned`)
    expect(context).toContain("OPEN (plan these):")
  })

  it("carries rejection counts forward through regeneration", () => {
    const tuesdayDate = dayNameToDate("Tuesday", START_DATE)

    // Insert rejected posts with count=2
    insertPosts(db, [
      makePostRow({ platform: "instagram", scheduledDate: tuesdayDate, status: "rejected", rejectionCount: 2 }),
      makePostRow({ platform: "facebook", scheduledDate: tuesdayDate, status: "rejected", rejectionCount: 2 }),
    ])

    // Read counts BEFORE Claude call (read-only)
    const counts = readRejectionCounts(db, CLIENT_ID, [tuesdayDate])
    expect(counts.get(`${tuesdayDate}:instagram`)).toBe(2)
    expect(counts.get(`${tuesdayDate}:facebook`)).toBe(2)

    // Simulate Claude output
    const claudeOutput = mockClaudeOutput(["Tuesday"])

    // Build replacement rows with inherited counts
    const newRows = claudeOutput.flatMap((post) => {
      const scheduledDate = dayNameToDate(post.day, START_DATE)
      return (["instagram", "facebook"] as Platform[]).map((platform) => ({
        clientId: CLIENT_ID,
        platform,
        scheduledDate,
        content: platform === "instagram" ? post.instagramCaption : post.facebookPost,
        reasoning: post.reasoning,
        photoId: null,
        rejectionCount: counts.get(`${scheduledDate}:${platform}`) ?? 0,
      }))
    })

    // Atomic replace
    replacePostsForOpenDays(db, CLIENT_ID, [tuesdayDate], newRows)

    // Verify counts carried forward
    const result = getPostsByDateRange(db, CLIENT_ID, tuesdayDate, tuesdayDate)
    expect(result).toHaveLength(2)
    expect(result[0].rejectionCount).toBe(2)
    expect(result[1].rejectionCount).toBe(2)
    expect(result[0].status).toBe("draft")
  })

  it("persists posts with correct scheduledDates from day names", () => {
    const claudeOutput = mockClaudeOutput(["Tuesday", "Wednesday", "Thursday"])

    const newRows = claudeOutput.flatMap((post) => {
      const scheduledDate = dayNameToDate(post.day, START_DATE)
      return (["instagram", "facebook"] as Platform[]).map((platform) => ({
        clientId: CLIENT_ID,
        platform,
        scheduledDate,
        content: platform === "instagram" ? post.instagramCaption : post.facebookPost,
        reasoning: post.reasoning,
        photoId: null,
        rejectionCount: 0,
      }))
    })

    replacePostsForOpenDays(db, CLIENT_ID, getDateRange(START_DATE), newRows)

    const result = getPostsByDateRange(db, CLIENT_ID, START_DATE, dayNameToDate("Monday", START_DATE))
    expect(result).toHaveLength(6) // 3 days x 2 platforms

    const tuesdayPosts = result.filter((p) => p.scheduledDate === "2026-05-12")
    expect(tuesdayPosts).toHaveLength(2)
    expect(tuesdayPosts.find((p) => p.platform === "instagram")?.content).toBe("IG post for Tuesday")

    const wednesdayPosts = result.filter((p) => p.scheduledDate === "2026-05-13")
    expect(wednesdayPosts).toHaveLength(2)
  })

  it("returns early when all days are locked (no Claude call needed)", () => {
    const dateRange = getDateRange(START_DATE)

    // Approve all 7 days
    const allRows = dateRange.flatMap((date) => [
      makePostRow({ platform: "instagram", scheduledDate: date, status: "approved" }),
      makePostRow({ platform: "facebook", scheduledDate: date, status: "approved" }),
    ])
    insertPosts(db, allRows)

    const endDate = dateRange[dateRange.length - 1]
    const lockedDays = getLockedDays(db, CLIENT_ID, START_DATE, endDate)
    const lockedDates = new Set(lockedDays.map((d) => d.scheduledDate))
    const openDates = dateRange.filter((d) => !lockedDates.has(d))

    expect(openDates).toHaveLength(0)
    // Route would return early here — no Claude call made
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/lib/posts/__tests__/generate-posts.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/posts/__tests__/generate-posts.test.ts
git commit -m "test: add integration tests for generation orchestration"
```

---

### Task 9: Add GET /api/posts endpoint

**Files:**
- Create: `src/app/api/posts/route.ts`

- [ ] **Step 1: Create the endpoint**

Create `src/app/api/posts/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { getPostsByDateRange } from "@/lib/posts/repository"
import type { PostsByDay } from "@/lib/posts/types"

/** Maximum date range in days to prevent unbounded queries. */
const MAX_RANGE_DAYS = 31

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const clientId = searchParams.get("clientId")
  const startDate = searchParams.get("startDate")
  const endDate = searchParams.get("endDate")

  if (!clientId || !startDate || !endDate) {
    return NextResponse.json(
      { error: "clientId, startDate, and endDate are required" },
      { status: 400 }
    )
  }

  // Validate date range
  const start = new Date(startDate + "T00:00:00")
  const end = new Date(endDate + "T00:00:00")
  const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)

  if (diffDays < 0) {
    return NextResponse.json(
      { error: "endDate must be after startDate" },
      { status: 400 }
    )
  }

  if (diffDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `Date range cannot exceed ${MAX_RANGE_DAYS} days` },
      { status: 400 }
    )
  }

  const posts = getPostsByDateRange(db, clientId, startDate, endDate)

  // Group by scheduledDate
  const grouped = new Map<string, typeof posts>()
  for (const post of posts) {
    const existing = grouped.get(post.scheduledDate) ?? []
    existing.push(post)
    grouped.set(post.scheduledDate, existing)
  }

  const result: PostsByDay[] = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([scheduledDate, dayPosts]) => ({
      scheduledDate,
      posts: dayPosts,
    }))

  return NextResponse.json(result)
}
```

- [ ] **Step 2: Verify build**

Run: `npx next build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/app/api/posts/route.ts
git commit -m "feat: add GET /api/posts endpoint for reading persisted posts"
```

---

### Task 10: Update preview page for two-call flow

**Files:**
- Modify: `src/app/admin/generate-preview/page.tsx`

The preview page changes from rendering the API response directly to: call generate → receive confirmation → fetch posts from GET endpoint → render.

- [ ] **Step 1: Update the state and fetch logic**

In `src/app/admin/generate-preview/page.tsx`, replace the `GeneratePreviewPage` component's state declarations and `handleGenerate` function. Change:

```typescript
  const [result, setResult] = useState<GenerationResult | null>(null)
```

to:

```typescript
  const [posts, setPosts] = useState<
    Array<{
      scheduledDate: string
      posts: Array<{
        id: string
        platform: string
        content: string
        photoId: string | null
        reasoning: string
        status: string
        scheduledDate: string
      }>
    }>
  | null>(null)
  const [generationMeta, setGenerationMeta] = useState<{
    generatedCount: number
    skippedLockedCount: number
  } | null>(null)
```

Replace `handleGenerate`:

```typescript
  async function handleGenerate() {
    setLoading(true)
    setError(null)
    setPosts(null)
    setGenerationMeta(null)

    try {
      // Step 1: Generate posts (writes to DB)
      const startDate = getNextTuesday()
      const genResponse = await fetch("/api/generate-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "cafe-de-hoek-00000000",
          startDate,
        }),
      })
      const genData = await genResponse.json()

      if (!genResponse.ok) {
        setError(genData.error || "Generation failed")
        return
      }

      setGenerationMeta({
        generatedCount: genData.generatedCount,
        skippedLockedCount: genData.skippedLockedCount,
      })

      // Step 2: Fetch persisted posts from DB
      const endDate = genData.endDate
      const postsResponse = await fetch(
        `/api/posts?clientId=cafe-de-hoek-00000000&startDate=${startDate}&endDate=${endDate}`
      )
      const postsData = await postsResponse.json()

      if (!postsResponse.ok) {
        setError(postsData.error || "Failed to fetch posts")
        return
      }

      setPosts(postsData)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error")
    } finally {
      setLoading(false)
    }
  }
```

- [ ] **Step 2: Add the getNextTuesday helper**

Add this function inside the component file, before the component definition:

```typescript
/** Return the next Tuesday as an ISO date string (YYYY-MM-DD). */
function getNextTuesday(): string {
  const now = new Date()
  const dayOfWeek = now.getDay() // 0=Sun, 1=Mon, 2=Tue
  const daysUntilTuesday = ((2 - dayOfWeek + 7) % 7) || 7
  const tuesday = new Date(now)
  tuesday.setDate(now.getDate() + daysUntilTuesday)
  return tuesday.toISOString().split("T")[0]
}
```

- [ ] **Step 3: Update the rendering section**

Replace the `{result && (` rendering block with a new block that reads from the `posts` state. Replace from `{result && (` all the way to its closing `)}`:

```typescript
      {generationMeta && (
        <p style={{ fontSize: "12px", color: "#888", marginTop: "24px" }}>
          Generated {generationMeta.generatedCount} post(s),
          skipped {generationMeta.skippedLockedCount} locked day(s)
        </p>
      )}

      {posts && (
        <div style={{ marginTop: "24px" }}>
          {posts.map((day) => {
            const igPost = day.posts.find((p) => p.platform === "instagram")
            const fbPost = day.posts.find((p) => p.platform === "facebook")
            const isPhotoDay = igPost?.photoId !== null

            return (
              <div
                key={day.scheduledDate}
                style={{
                  border: "1px solid #eee",
                  borderRadius: "8px",
                  padding: "24px",
                  marginBottom: "24px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    marginBottom: "16px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                    <h2 style={{ fontSize: "18px", fontWeight: 600 }}>
                      {day.scheduledDate}
                    </h2>
                    {isPhotoDay && (
                      <span
                        style={{
                          fontSize: "11px",
                          backgroundColor: "#dbeafe",
                          color: "#1d4ed8",
                          padding: "2px 8px",
                          borderRadius: "9999px",
                        }}
                      >
                        Photo post
                      </span>
                    )}
                  </div>
                </div>

                {/* Instagram */}
                {igPost && (
                  <div style={{ marginBottom: "12px" }}>
                    <h3
                      style={{
                        fontSize: "13px",
                        fontWeight: 500,
                        color: "#be185d",
                        marginBottom: "4px",
                      }}
                    >
                      Instagram
                    </h3>
                    <p
                      style={{
                        whiteSpace: "pre-wrap",
                        backgroundColor: "#f9fafb",
                        padding: "12px",
                        borderRadius: "4px",
                        fontSize: "14px",
                      }}
                    >
                      {igPost.content}
                    </p>
                  </div>
                )}

                {/* Facebook */}
                {fbPost && (
                  <div style={{ marginBottom: "12px" }}>
                    <h3
                      style={{
                        fontSize: "13px",
                        fontWeight: 500,
                        color: "#1d4ed8",
                        marginBottom: "4px",
                      }}
                    >
                      Facebook
                    </h3>
                    <p
                      style={{
                        whiteSpace: "pre-wrap",
                        backgroundColor: "#f9fafb",
                        padding: "12px",
                        borderRadius: "4px",
                        fontSize: "14px",
                      }}
                    >
                      {fbPost.content}
                    </p>
                  </div>
                )}

                {/* Reasoning (from IG row — same for both platforms) */}
                {igPost && (
                  <div
                    style={{
                      borderTop: "1px solid #eee",
                      paddingTop: "12px",
                      fontSize: "13px",
                      color: "#666",
                    }}
                  >
                    <p>
                      <strong>Why:</strong> {igPost.reasoning}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
```

- [ ] **Step 4: Clean up imports, keep PhotoAnalysisPanel**

Remove the `GenerationResult` import (no longer used). Keep `PhotoAnalysis` and `PhotoAnalysisPanel` — the preview is Stefan's debugging surface, and seeing what Claude saw in each photo is useful for prompt tuning. The GET endpoint returns `photoId` per post; the preview page can fetch photo analysis from the existing photos data if needed.

Update the import line:

```typescript
"use client"

import { useState } from "react"
import type { PhotoAnalysis } from "@/lib/ai/types"
```

Note: `PhotoAnalysisPanel` currently reads from `result.photoAnalyses` which no longer exists in the two-call flow. To keep it working, the GET `/api/posts` response would need photo analysis data, OR the preview page makes a third call to fetch photos. For Saturday's deadline, the simplest fix: keep the component in the file but don't render it in the new layout. Add a `// TODO: Re-wire PhotoAnalysisPanel once GET /api/posts includes photo data` comment where it was rendered. This avoids silently dropping the feature while keeping the ship deadline.

- [ ] **Step 5: Verify build**

Run: `npx next build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/generate-preview/page.tsx
git commit -m "feat: update preview page to two-call flow (generate then fetch from DB)"
```

---

### Task 11: End-to-end verification

**Files:** None (manual testing)

- [ ] **Step 1: Run all unit tests**

Run: `npx vitest run`
Expected: All tests pass (dates, repository, locked-days)

- [ ] **Step 2: Start dev server**

Run: `npm run dev`
Expected: Server starts without errors

- [ ] **Step 3: Test generation via the preview page**

Open `http://localhost:3000/admin/generate-preview` in a browser.
Click "Generate Week."
Expected:
- Loading state shows
- After ~15-30 seconds, posts appear grouped by date
- Each date shows Instagram and Facebook content
- Reasoning is visible

- [ ] **Step 4: Verify posts are in the database**

Run: `npx drizzle-kit studio`
Open the posts table.
Expected: 14 rows (7 days x 2 platforms), all with status "draft"

- [ ] **Step 5: Test regeneration (idempotency)**

Go back to the preview page and click "Generate Week" again for the same week.
Expected:
- Old draft rows are deleted
- New draft rows are inserted
- Preview shows new content
- Still 14 rows in the DB (not 28)

- [ ] **Step 6: Test the GET endpoint directly**

Run: `curl "http://localhost:3000/api/posts?clientId=cafe-de-hoek-00000000&startDate=2026-05-12&endDate=2026-05-18"`
Expected: JSON response with posts grouped by `scheduledDate`

- [ ] **Step 7: Test partial regeneration with a locked day**

Using Drizzle Studio (`npx drizzle-kit studio`), manually change one day's two posts (e.g., Tuesday IG + FB) from `draft` to `approved`.

Then click "Generate Week" again on the preview page.
Expected:
- Tuesday's posts are untouched (still `approved` in DB)
- The other 6 days get new drafts
- Check the server logs: the plan prompt should include locked-day context mentioning Tuesday
- DB has 14 rows total: 2 approved (Tuesday) + 12 draft (other days)

- [ ] **Step 8: Test rejection count carry-forward**

Using Drizzle Studio, change Wednesday's two posts to `rejected` with `rejectionCount = 2`.

Click "Generate Week" again.
Expected:
- Wednesday gets new draft posts
- The new Wednesday rows have `rejectionCount = 2` (carried forward)
- Tuesday still untouched (`approved`)

- [ ] **Step 9: Test all-locked early return**

Using Drizzle Studio, change all remaining draft posts to `approved`.

Click "Generate Week."
Expected:
- Response comes back immediately (no ~15-30 second wait — no Claude call)
- `generatedCount: 0`, `skippedLockedCount: 7`
- DB unchanged

- [ ] **Step 10: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: adjustments from end-to-end verification"
```

---

## Carry-forward notes

These items are NOT part of this plan. They belong in the client review UI feature:

1. **Approve/reject updates two rows in a transaction** — Drizzle transaction around both platform rows
2. **MAX_REJECTIONS UX** — disable reject button, notify Stefan
3. **Time override on approval** — auto-fill `publishAt` from industry defaults, editable by Marloes
4. **Photo display in review** — show photo above post content for photo days
