# Owner Attention List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Owner Attention List at `/admin` (Operator Console aesthetic) — a server-rendered page that shows Stefan exactly which posts and clients need his attention, in urgency order, from already-stamped alert columns.

**Architecture:** New aggregation module `src/lib/admin/attention.ts` with one query function per signal (failed, overdue, stale, regen-limit, unseen, rejected, calibration) composed by a `getAttentionData(db, now)` combiner. Two new presentational components (section wrapper + item row). Existing `/admin` page becomes the Attention List; the old user table moves to `/admin/users`. A small admin nav header threads the new structure together.

**Tech Stack:** Drizzle ORM (Postgres), Vitest + PGlite for tests, Next.js 16 App Router server components, Tailwind 4 (already configured) + Geist Sans / Geist Mono (already loaded via `src/app/layout.tsx`).

**Reference:** `docs/superpowers/specs/2026-05-12-attention-list-design.md`. Aesthetic Option A (Operator Console) is locked.

---

## File Map

### New files

| Path | Responsibility |
|---|---|
| `src/lib/admin/attention.ts` | Aggregation queries + combiner. Exports `getAttentionData`, types, and one internal query function per section. |
| `src/lib/admin/__tests__/attention.test.ts` | Vitest + PGlite tests, one `describe` per section + integration tests for the combiner. |
| `src/app/admin/users/page.tsx` | The old user table, moved here verbatim. |
| `src/components/admin/admin-nav.tsx` | Top nav strip used on every admin page (Attention / Clients / Users / Generate / Sign out). |
| `src/components/admin/attention-section.tsx` | Section wrapper: title, count badge, empty-state message, slot for items. |
| `src/components/admin/attention-item.tsx` | Row for a post-anchored signal (failed, overdue, stale, regen, unseen, rejected). |
| `src/components/admin/calibration-item.tsx` | Row for a client-anchored signal (calibration callout). Different shape from `attention-item`. |
| `src/styles/admin-tokens.css` | Operator-console CSS custom properties (palette + severity colors). Imported once from the admin layout. |
| `src/app/admin/layout.tsx` | Admin section layout: imports admin-tokens.css and renders `<AdminNav />` once for all admin pages. |

### Modified files

| Path | Change |
|---|---|
| `src/app/admin/page.tsx` | Replace user-table contents with the Attention List server component. |

### NOT touched (and why)

- `src/db/schema.ts` — no new tables. Spec §3e: existing indexes are sufficient for v1.
- `src/app/admin/clients/**` — out of scope.
- `src/app/admin/delete-user-button.tsx` — moves logically to `/admin/users` but the file itself is reusable; it stays where it is and `src/app/admin/users/page.tsx` imports from `../delete-user-button`. Future cleanup can relocate it.
- `.env*` — never read or modified.

---

## Aggregation Layer Conventions

Every query function in `src/lib/admin/attention.ts` follows the same shape:

```ts
async function findX(db: Db, now: Date): Promise<AttentionItem[]>
```

Items are returned sorted ascending by `signalAt` (oldest signal first — that's the most urgent within a section). The combiner does no extra sorting; section order is the urgency rank, item order within each section is age.

`Db` is the existing local alias used in `src/lib/posts/repository.ts` and `src/lib/alerts/check-stale-posts.ts`. We re-declare it here rather than refactoring the duplication (out of scope per session instructions).

Cross-section deduplication is explicitly NOT done — a post that's both stale and regen-limit-hit appears in both sections (spec §5).

`contentPreview` is `content.slice(0, 80)` — done in JS after the query, not in SQL.

`businessName` and `platform` come from joining `posts` to `clients` in a single query per section.

---

## Task 0: Baseline verification

**Files:** none

- [ ] **Step 1: Confirm baseline tests pass**

Run:
```
npm test
```
Expected: all tests green (163 from base + any from PR #15). If any fail, stop and write a status doc — do not proceed.

- [ ] **Step 2: Confirm typecheck passes**

Run:
```
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Confirm we're on the right branch**

Run:
```
git branch --show-current
```
Expected: `feat/attention-list`.

No commit at the end of this task. It's a smoke check only.

---

## Task 1: Attention module skeleton + types

**Files:**
- Create: `src/lib/admin/attention.ts`
- Create: `src/lib/admin/__tests__/attention.test.ts`

- [ ] **Step 1: Write the skeleton module with types and an empty combiner**

Create `src/lib/admin/attention.ts`:

```ts
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

/** First 80 characters of post content, used as the preview shown on each row. */
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

// Internal helpers used by individual section queries are exported below
// as they are implemented. Kept on the module surface so the test file
// can exercise each in isolation.
export const __internal = { preview }
```

- [ ] **Step 2: Write a passing baseline test that the module imports**

Create `src/lib/admin/__tests__/attention.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest"
import { createTestDb, seedTestClient, type TestDb } from "@/test/db"
import { getAttentionData } from "../attention"

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
})

describe("getAttentionData (empty DB)", () => {
  it("returns empty arrays for every section when nothing exists", async () => {
    const now = new Date("2026-05-12T10:00:00Z")
    const data = await getAttentionData(db, now)

    expect(data.failedPosts).toEqual([])
    expect(data.overduePosts).toEqual([])
    expect(data.staleDrafts).toEqual([])
    expect(data.regenLimitHits).toEqual([])
    expect(data.unseenDrafts).toEqual([])
    expect(data.recentRejections).toEqual([])
    expect(data.calibrationClients).toEqual([])
  })
})

describe("getAttentionData (with seeded client but no posts)", () => {
  it("returns empty post-anchored sections", async () => {
    // Seed a client created long ago so calibration also doesn't fire.
    await seedTestClient(db, "client-001")
    // Push createdAt backwards so the client is not "new".
    // We do this by writing the client directly; seedTestClient default uses now.
    const now = new Date("2026-05-12T10:00:00Z")
    const data = await getAttentionData(db, now)

    expect(data.failedPosts).toEqual([])
    expect(data.overduePosts).toEqual([])
    expect(data.staleDrafts).toEqual([])
    expect(data.regenLimitHits).toEqual([])
    expect(data.unseenDrafts).toEqual([])
    expect(data.recentRejections).toEqual([])
  })
})
```

- [ ] **Step 3: Run tests, verify they pass**

Run:
```
npm test -- src/lib/admin/__tests__/attention.test.ts
```
Expected: 2 passing tests.

- [ ] **Step 4: Commit**

```
git add src/lib/admin/attention.ts src/lib/admin/__tests__/attention.test.ts
git commit -m "feat(admin): scaffold attention-list module with types and empty combiner"
```

---

## Task 2: findFailedPosts query

**Files:**
- Modify: `src/lib/admin/attention.ts`
- Modify: `src/lib/admin/__tests__/attention.test.ts`

**Signal definition (spec §3b §1):** `posts.status = 'failed' OR posts.publishError IS NOT NULL`. `signalAt = posts.updatedAt`. Sort ascending. Note: spec also notes this section is empty until #5 ships, but the query itself must be correct now.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/admin/__tests__/attention.test.ts`:

```ts
import { posts } from "@/db/schema"
import { insertPosts } from "@/lib/posts/repository"
import { eq } from "drizzle-orm"
import { findFailedPosts } from "../attention"

describe("findFailedPosts", () => {
  it("returns posts with status='failed'", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-10",
      content: "Failed post content here, this is the body of the post that did not publish.",
      reasoning: "n/a",
    }])
    const rows = await db.select().from(posts).limit(1)
    const updatedAt = new Date("2026-05-12T09:00:00Z")
    await db.update(posts)
      .set({ status: "failed", publishError: "rate limit", updatedAt })
      .where(eq(posts.id, rows[0]!.id))

    const now = new Date("2026-05-12T10:00:00Z")
    const items = await findFailedPosts(db, now)

    expect(items).toHaveLength(1)
    expect(items[0]!.signalType).toBe("failed")
    expect(items[0]!.postId).toBe(rows[0]!.id)
    expect(items[0]!.clientId).toBe("client-001")
    expect(items[0]!.businessName).toBe("Test Café")
    expect(items[0]!.platform).toBe("instagram")
    expect(items[0]!.scheduledDate).toBe("2026-05-10")
    expect(items[0]!.signalAt).toEqual(updatedAt)
    expect(items[0]!.contentPreview.length).toBeLessThanOrEqual(80)
  })

  it("also returns posts with non-null publishError even if status is not failed", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "facebook",
      scheduledDate: "2026-05-11",
      content: "Approved but publish error",
      reasoning: "n/a",
    }])
    const rows = await db.select().from(posts).limit(1)
    await db.update(posts)
      .set({ status: "approved", publishError: "blocked by meta" })
      .where(eq(posts.id, rows[0]!.id))

    const items = await findFailedPosts(db, new Date("2026-05-12T10:00:00Z"))

    expect(items).toHaveLength(1)
  })

  it("does not return healthy drafts or successfully published posts", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [
      {
        clientId: "client-001",
        platform: "instagram",
        scheduledDate: "2026-05-10",
        content: "ok draft",
        reasoning: "n/a",
      },
      {
        clientId: "client-001",
        platform: "facebook",
        scheduledDate: "2026-05-10",
        content: "ok published",
        reasoning: "n/a",
      },
    ])
    await db.update(posts)
      .set({ status: "published", publishedAt: new Date("2026-05-10T10:00:00Z") })
      .where(eq(posts.platform, "facebook"))

    const items = await findFailedPosts(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })

  it("sorts oldest-signal-first across multiple clients", async () => {
    await seedTestClient(db, "client-001")
    await seedTestClient(db, "client-002")

    await insertPosts(db, [
      { clientId: "client-001", platform: "instagram", scheduledDate: "2026-05-10", content: "A", reasoning: "n/a" },
      { clientId: "client-002", platform: "instagram", scheduledDate: "2026-05-10", content: "B", reasoning: "n/a" },
    ])
    await db.update(posts)
      .set({ status: "failed", updatedAt: new Date("2026-05-12T09:00:00Z") })
      .where(eq(posts.clientId, "client-001"))
    await db.update(posts)
      .set({ status: "failed", updatedAt: new Date("2026-05-12T05:00:00Z") })
      .where(eq(posts.clientId, "client-002"))

    const items = await findFailedPosts(db, new Date("2026-05-12T10:00:00Z"))

    expect(items.map((i) => i.clientId)).toEqual(["client-002", "client-001"])
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```
npm test -- src/lib/admin/__tests__/attention.test.ts
```
Expected: 4 failures with "findFailedPosts is not a function" (or undefined import).

- [ ] **Step 3: Implement `findFailedPosts`**

Add to `src/lib/admin/attention.ts` (after the `preview` helper, before `getAttentionData`):

```ts
import { and, asc, eq, isNotNull, or, sql } from "drizzle-orm"

const itemSelect = {
  postId: schema.posts.id,
  clientId: schema.posts.clientId,
  platform: schema.posts.platform,
  scheduledDate: schema.posts.scheduledDate,
  content: schema.posts.content,
  businessName: schema.clients.businessName,
}

export async function findFailedPosts(db: Db, _now: Date): Promise<AttentionItem[]> {
  const rows = await db
    .select({
      ...itemSelect,
      signalAt: schema.posts.updatedAt,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.posts.clientId))
    .where(or(eq(schema.posts.status, "failed"), isNotNull(schema.posts.publishError)))
    .orderBy(asc(schema.posts.updatedAt))

  return rows.map((r) => ({
    signalType: "failed" as const,
    postId: r.postId,
    clientId: r.clientId,
    businessName: r.businessName,
    platform: r.platform as "instagram" | "facebook",
    scheduledDate: r.scheduledDate,
    signalAt: r.signalAt,
    contentPreview: preview(r.content),
  }))
}
```

Also wire it into `getAttentionData`:

```ts
export async function getAttentionData(db: Db, now: Date): Promise<AttentionData> {
  return {
    failedPosts: await findFailedPosts(db, now),
    overduePosts: [],
    staleDrafts: [],
    regenLimitHits: [],
    unseenDrafts: [],
    recentRejections: [],
    calibrationClients: [],
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run:
```
npm test -- src/lib/admin/__tests__/attention.test.ts
```
Expected: 6 passing tests (2 from Task 1 + 4 new).

- [ ] **Step 5: Commit**

```
git add src/lib/admin/attention.ts src/lib/admin/__tests__/attention.test.ts
git commit -m "feat(admin): add findFailedPosts query for attention list"
```

---

## Task 3: findOverduePosts query

**Signal definition (spec §3b §2):** `status = 'approved' AND publishAt < now AND publishedAt IS NULL`. `signalAt = posts.publishAt`. Sort ascending.

**Files:**
- Modify: `src/lib/admin/attention.ts`
- Modify: `src/lib/admin/__tests__/attention.test.ts`

- [ ] **Step 1: Write the failing test**

Append to test file:

```ts
import { lt, gt } from "drizzle-orm"
import { findOverduePosts } from "../attention"

describe("findOverduePosts", () => {
  it("returns approved posts whose publishAt is in the past and not yet published", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-10",
      content: "Overdue post",
      reasoning: "n/a",
    }])
    const publishAt = new Date("2026-05-10T09:00:00Z")
    await db.update(posts)
      .set({ status: "approved", publishAt, approvedAt: new Date("2026-05-09T10:00:00Z") })

    const items = await findOverduePosts(db, new Date("2026-05-12T10:00:00Z"))

    expect(items).toHaveLength(1)
    expect(items[0]!.signalType).toBe("overdue")
    expect(items[0]!.signalAt).toEqual(publishAt)
  })

  it("excludes approved posts scheduled for the future", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-20",
      content: "Future approved",
      reasoning: "n/a",
    }])
    await db.update(posts)
      .set({ status: "approved", publishAt: new Date("2026-05-20T09:00:00Z") })

    const items = await findOverduePosts(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })

  it("excludes published posts even if publishAt is in the past", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-10",
      content: "Published",
      reasoning: "n/a",
    }])
    await db.update(posts)
      .set({
        status: "published",
        publishAt: new Date("2026-05-10T09:00:00Z"),
        publishedAt: new Date("2026-05-10T09:01:00Z"),
      })

    const items = await findOverduePosts(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })

  it("excludes drafts (only approved counts)", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-10",
      content: "Draft past publishAt",
      reasoning: "n/a",
    }])
    await db.update(posts)
      .set({ publishAt: new Date("2026-05-10T09:00:00Z") })

    const items = await findOverduePosts(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

```
npm test -- src/lib/admin/__tests__/attention.test.ts
```
Expected: 4 new failures.

- [ ] **Step 3: Implement `findOverduePosts`**

Add to `src/lib/admin/attention.ts`:

```ts
import { isNull } from "drizzle-orm"

export async function findOverduePosts(db: Db, now: Date): Promise<AttentionItem[]> {
  const rows = await db
    .select({
      ...itemSelect,
      signalAt: schema.posts.publishAt,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.posts.clientId))
    .where(and(
      eq(schema.posts.status, "approved"),
      isNull(schema.posts.publishedAt),
      sql`${schema.posts.publishAt} < ${now}`,
    ))
    .orderBy(asc(schema.posts.publishAt))

  return rows.map((r) => ({
    signalType: "overdue" as const,
    postId: r.postId,
    clientId: r.clientId,
    businessName: r.businessName,
    platform: r.platform as "instagram" | "facebook",
    scheduledDate: r.scheduledDate,
    // publishAt is nullable in the schema but the WHERE clause guarantees non-null.
    signalAt: r.signalAt as Date,
    contentPreview: preview(r.content),
  }))
}
```

Wire into combiner:
```ts
overduePosts: await findOverduePosts(db, now),
```

- [ ] **Step 4: Run tests, verify they pass**

```
npm test -- src/lib/admin/__tests__/attention.test.ts
```
Expected: 10 passing.

- [ ] **Step 5: Commit**

```
git add src/lib/admin/attention.ts src/lib/admin/__tests__/attention.test.ts
git commit -m "feat(admin): add findOverduePosts query for attention list"
```

---

## Task 4: findStaleDrafts query

**Signal definition (spec §3b §3):** `alertedAt IS NOT NULL` (Stefan has been emailed about this post). Excludes posts already approved/rejected/published — only `status = 'draft'` is interesting. `signalAt = posts.alertedAt`. Sort ascending.

**Files:**
- Modify: `src/lib/admin/attention.ts`
- Modify: `src/lib/admin/__tests__/attention.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
import { findStaleDrafts } from "../attention"

describe("findStaleDrafts", () => {
  it("returns draft posts where alertedAt is set", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-12",
      content: "Stale draft",
      reasoning: "n/a",
    }])
    const alertedAt = new Date("2026-05-12T05:00:00Z")
    await db.update(posts)
      .set({ firstSeenAt: new Date("2026-05-11T05:00:00Z"), alertedAt })

    const items = await findStaleDrafts(db, new Date("2026-05-12T10:00:00Z"))

    expect(items).toHaveLength(1)
    expect(items[0]!.signalType).toBe("stale")
    expect(items[0]!.signalAt).toEqual(alertedAt)
  })

  it("excludes drafts that were never alerted", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-12",
      content: "Not yet alerted",
      reasoning: "n/a",
    }])

    const items = await findStaleDrafts(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })

  it("excludes approved or published posts even if alertedAt was set earlier", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-12",
      content: "Now approved",
      reasoning: "n/a",
    }])
    await db.update(posts)
      .set({ status: "approved", alertedAt: new Date("2026-05-12T05:00:00Z") })

    const items = await findStaleDrafts(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })

  it("sorts oldest alert first", async () => {
    await seedTestClient(db, "client-001")
    await seedTestClient(db, "client-002")
    await insertPosts(db, [
      { clientId: "client-001", platform: "instagram", scheduledDate: "2026-05-12", content: "Newer", reasoning: "n/a" },
      { clientId: "client-002", platform: "instagram", scheduledDate: "2026-05-12", content: "Older", reasoning: "n/a" },
    ])
    await db.update(posts).set({ alertedAt: new Date("2026-05-12T07:00:00Z") }).where(eq(posts.clientId, "client-001"))
    await db.update(posts).set({ alertedAt: new Date("2026-05-12T03:00:00Z") }).where(eq(posts.clientId, "client-002"))

    const items = await findStaleDrafts(db, new Date("2026-05-12T10:00:00Z"))
    expect(items.map((i) => i.clientId)).toEqual(["client-002", "client-001"])
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

```
npm test -- src/lib/admin/__tests__/attention.test.ts
```
Expected: 4 new failures.

- [ ] **Step 3: Implement `findStaleDrafts`**

```ts
export async function findStaleDrafts(db: Db, _now: Date): Promise<AttentionItem[]> {
  const rows = await db
    .select({
      ...itemSelect,
      signalAt: schema.posts.alertedAt,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.posts.clientId))
    .where(and(
      eq(schema.posts.status, "draft"),
      isNotNull(schema.posts.alertedAt),
    ))
    .orderBy(asc(schema.posts.alertedAt))

  return rows.map((r) => ({
    signalType: "stale" as const,
    postId: r.postId,
    clientId: r.clientId,
    businessName: r.businessName,
    platform: r.platform as "instagram" | "facebook",
    scheduledDate: r.scheduledDate,
    signalAt: r.signalAt as Date,
    contentPreview: preview(r.content),
  }))
}
```

Wire into combiner:
```ts
staleDrafts: await findStaleDrafts(db, now),
```

- [ ] **Step 4: Run tests, verify they pass**

```
npm test -- src/lib/admin/__tests__/attention.test.ts
```
Expected: 14 passing.

- [ ] **Step 5: Commit**

```
git add src/lib/admin/attention.ts src/lib/admin/__tests__/attention.test.ts
git commit -m "feat(admin): add findStaleDrafts query for attention list"
```

---

## Task 5: findRegenLimitHits query

**Signal definition (spec §3b §4):** `regenLimitAlertedAt IS NOT NULL` (client tried to regen 3× and an alert was sent). Only relevant for posts still in draft/rejected (resolved when client approves). `signalAt = posts.regenLimitAlertedAt`. Sort ascending.

**Files:**
- Modify: `src/lib/admin/attention.ts`
- Modify: `src/lib/admin/__tests__/attention.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
import { findRegenLimitHits } from "../attention"

describe("findRegenLimitHits", () => {
  it("returns posts where regenLimitAlertedAt is set and status is draft", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-12",
      content: "Regen-limit hit",
      reasoning: "n/a",
    }])
    const at = new Date("2026-05-12T06:00:00Z")
    await db.update(posts).set({ regenLimitAlertedAt: at, rejectionCount: 3 })

    const items = await findRegenLimitHits(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toHaveLength(1)
    expect(items[0]!.signalType).toBe("regen-limit")
    expect(items[0]!.signalAt).toEqual(at)
  })

  it("excludes posts whose status is approved or published", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-12",
      content: "Approved after regen-limit",
      reasoning: "n/a",
    }])
    await db.update(posts).set({
      status: "approved",
      regenLimitAlertedAt: new Date("2026-05-12T06:00:00Z"),
    })

    const items = await findRegenLimitHits(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })

  it("excludes posts where regenLimitAlertedAt is null", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-12",
      content: "No regen alert",
      reasoning: "n/a",
    }])

    const items = await findRegenLimitHits(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

```
npm test -- src/lib/admin/__tests__/attention.test.ts
```
Expected: 3 new failures.

- [ ] **Step 3: Implement `findRegenLimitHits`**

```ts
export async function findRegenLimitHits(db: Db, _now: Date): Promise<AttentionItem[]> {
  const rows = await db
    .select({
      ...itemSelect,
      signalAt: schema.posts.regenLimitAlertedAt,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.posts.clientId))
    .where(and(
      eq(schema.posts.status, "draft"),
      isNotNull(schema.posts.regenLimitAlertedAt),
    ))
    .orderBy(asc(schema.posts.regenLimitAlertedAt))

  return rows.map((r) => ({
    signalType: "regen-limit" as const,
    postId: r.postId,
    clientId: r.clientId,
    businessName: r.businessName,
    platform: r.platform as "instagram" | "facebook",
    scheduledDate: r.scheduledDate,
    signalAt: r.signalAt as Date,
    contentPreview: preview(r.content),
  }))
}
```

Wire into combiner:
```ts
regenLimitHits: await findRegenLimitHits(db, now),
```

- [ ] **Step 4: Run tests, verify they pass**

```
npm test -- src/lib/admin/__tests__/attention.test.ts
```
Expected: 17 passing.

- [ ] **Step 5: Commit**

```
git add src/lib/admin/attention.ts src/lib/admin/__tests__/attention.test.ts
git commit -m "feat(admin): add findRegenLimitHits query for attention list"
```

---

## Task 6: findUnseenDrafts query

**Signal definition (spec §3b §5):** `status = 'draft' AND firstSeenAt IS NULL` — client hasn't opened the post yet. `signalAt = posts.createdAt`. Sort ascending.

**Files:**
- Modify: `src/lib/admin/attention.ts`
- Modify: `src/lib/admin/__tests__/attention.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
import { findUnseenDrafts } from "../attention"

describe("findUnseenDrafts", () => {
  it("returns draft posts with firstSeenAt null", async () => {
    await seedTestClient(db, "client-001")
    const createdAt = new Date("2026-05-11T14:00:00Z")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-12",
      content: "Unseen by client",
      reasoning: "n/a",
    }])
    await db.update(posts).set({ createdAt })

    const items = await findUnseenDrafts(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toHaveLength(1)
    expect(items[0]!.signalType).toBe("unseen")
    expect(items[0]!.signalAt).toEqual(createdAt)
  })

  it("excludes drafts the client has opened (firstSeenAt set)", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-12",
      content: "Seen",
      reasoning: "n/a",
    }])
    await db.update(posts).set({ firstSeenAt: new Date("2026-05-11T15:00:00Z") })

    const items = await findUnseenDrafts(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })

  it("excludes non-draft posts even if firstSeenAt is null (defensive)", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-12",
      content: "Edge case",
      reasoning: "n/a",
    }])
    await db.update(posts).set({ status: "approved" })

    const items = await findUnseenDrafts(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

```
npm test -- src/lib/admin/__tests__/attention.test.ts
```
Expected: 3 new failures.

- [ ] **Step 3: Implement `findUnseenDrafts`**

```ts
export async function findUnseenDrafts(db: Db, _now: Date): Promise<AttentionItem[]> {
  const rows = await db
    .select({
      ...itemSelect,
      signalAt: schema.posts.createdAt,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.posts.clientId))
    .where(and(
      eq(schema.posts.status, "draft"),
      isNull(schema.posts.firstSeenAt),
    ))
    .orderBy(asc(schema.posts.createdAt))

  return rows.map((r) => ({
    signalType: "unseen" as const,
    postId: r.postId,
    clientId: r.clientId,
    businessName: r.businessName,
    platform: r.platform as "instagram" | "facebook",
    scheduledDate: r.scheduledDate,
    signalAt: r.signalAt,
    contentPreview: preview(r.content),
  }))
}
```

Wire into combiner:
```ts
unseenDrafts: await findUnseenDrafts(db, now),
```

- [ ] **Step 4: Run tests, verify they pass**

```
npm test -- src/lib/admin/__tests__/attention.test.ts
```
Expected: 20 passing.

- [ ] **Step 5: Commit**

```
git add src/lib/admin/attention.ts src/lib/admin/__tests__/attention.test.ts
git commit -m "feat(admin): add findUnseenDrafts query for attention list"
```

---

## Task 7: findRecentRejections query

**Signal definition (spec §3b §6):** `status = 'rejected' AND rejectedAt > now - 7 days`. `signalAt = posts.rejectedAt`. Sort ascending (oldest rejection within the window first — pattern-finding section).

**Files:**
- Modify: `src/lib/admin/attention.ts`
- Modify: `src/lib/admin/__tests__/attention.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
import { findRecentRejections } from "../attention"

describe("findRecentRejections", () => {
  it("returns posts rejected within the last 7 days", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-08",
      content: "Recently rejected",
      reasoning: "n/a",
    }])
    const rejectedAt = new Date("2026-05-10T10:00:00Z")
    await db.update(posts).set({ status: "rejected", rejectedAt })

    const items = await findRecentRejections(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toHaveLength(1)
    expect(items[0]!.signalType).toBe("rejected")
    expect(items[0]!.signalAt).toEqual(rejectedAt)
  })

  it("excludes rejections older than 7 days", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-04-30",
      content: "Old rejection",
      reasoning: "n/a",
    }])
    await db.update(posts).set({
      status: "rejected",
      rejectedAt: new Date("2026-05-04T10:00:00Z"), // 8 days before now
    })

    const items = await findRecentRejections(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })

  it("excludes posts that are not in rejected status", async () => {
    await seedTestClient(db, "client-001")
    await insertPosts(db, [{
      clientId: "client-001",
      platform: "instagram",
      scheduledDate: "2026-05-10",
      content: "Draft with stale rejectedAt timestamp from prior cycle",
      reasoning: "n/a",
    }])
    // Defensive: rejectedAt is set but current status is draft (regenerated copy)
    await db.update(posts).set({
      status: "draft",
      rejectedAt: new Date("2026-05-10T10:00:00Z"),
    })

    const items = await findRecentRejections(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

```
npm test -- src/lib/admin/__tests__/attention.test.ts
```
Expected: 3 new failures.

- [ ] **Step 3: Implement `findRecentRejections`**

```ts
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export async function findRecentRejections(db: Db, now: Date): Promise<AttentionItem[]> {
  const since = new Date(now.getTime() - SEVEN_DAYS_MS)
  const rows = await db
    .select({
      ...itemSelect,
      signalAt: schema.posts.rejectedAt,
    })
    .from(schema.posts)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.posts.clientId))
    .where(and(
      eq(schema.posts.status, "rejected"),
      sql`${schema.posts.rejectedAt} > ${since}`,
    ))
    .orderBy(asc(schema.posts.rejectedAt))

  return rows.map((r) => ({
    signalType: "rejected" as const,
    postId: r.postId,
    clientId: r.clientId,
    businessName: r.businessName,
    platform: r.platform as "instagram" | "facebook",
    scheduledDate: r.scheduledDate,
    signalAt: r.signalAt as Date,
    contentPreview: preview(r.content),
  }))
}
```

Wire into combiner:
```ts
recentRejections: await findRecentRejections(db, now),
```

- [ ] **Step 4: Run tests, verify they pass**

```
npm test -- src/lib/admin/__tests__/attention.test.ts
```
Expected: 23 passing.

- [ ] **Step 5: Commit**

```
git add src/lib/admin/attention.ts src/lib/admin/__tests__/attention.test.ts
git commit -m "feat(admin): add findRecentRejections query for attention list"
```

---

## Task 8: findCalibrationClients query

**Signal definition (spec §3b §7):** clients where `createdAt > now - 7 days`. Returns a `CalibrationItem` (different shape — anchored on client, not post). `joinedAt = clients.createdAt`. `postCount = count of posts for that client`. Sort ascending by joinedAt (newest signal last so oldest clients in the window appear first — they've had more time and the lack of activity is more notable).

**Files:**
- Modify: `src/lib/admin/attention.ts`
- Modify: `src/lib/admin/__tests__/attention.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
import { findCalibrationClients } from "../attention"
import { clients as clientsTable } from "@/db/schema"

describe("findCalibrationClients", () => {
  it("returns clients created within the last 7 days with their post count", async () => {
    await seedTestClient(db, "client-new")
    const joinedAt = new Date("2026-05-10T10:00:00Z")
    await db.update(clientsTable).set({ createdAt: joinedAt }).where(eq(clientsTable.id, "client-new"))

    const items = await findCalibrationClients(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toHaveLength(1)
    expect(items[0]!.clientId).toBe("client-new")
    expect(items[0]!.businessName).toBe("Test Café")
    expect(items[0]!.joinedAt).toEqual(joinedAt)
    expect(items[0]!.postCount).toBe(0)
  })

  it("counts posts correctly", async () => {
    await seedTestClient(db, "client-new")
    await db.update(clientsTable)
      .set({ createdAt: new Date("2026-05-10T10:00:00Z") })
      .where(eq(clientsTable.id, "client-new"))
    await insertPosts(db, [
      { clientId: "client-new", platform: "instagram", scheduledDate: "2026-05-12", content: "p1", reasoning: "n/a" },
      { clientId: "client-new", platform: "facebook",  scheduledDate: "2026-05-12", content: "p2", reasoning: "n/a" },
    ])

    const items = await findCalibrationClients(db, new Date("2026-05-12T10:00:00Z"))
    expect(items[0]!.postCount).toBe(2)
  })

  it("excludes clients older than 7 days", async () => {
    await seedTestClient(db, "client-old")
    await db.update(clientsTable)
      .set({ createdAt: new Date("2026-05-04T09:00:00Z") })
      .where(eq(clientsTable.id, "client-old"))

    const items = await findCalibrationClients(db, new Date("2026-05-12T10:00:00Z"))
    expect(items).toEqual([])
  })

  it("sorts oldest joinedAt first within the calibration window", async () => {
    await seedTestClient(db, "client-a")
    await seedTestClient(db, "client-b")
    await db.update(clientsTable).set({ createdAt: new Date("2026-05-10T10:00:00Z") }).where(eq(clientsTable.id, "client-a"))
    await db.update(clientsTable).set({ createdAt: new Date("2026-05-07T10:00:00Z") }).where(eq(clientsTable.id, "client-b"))

    const items = await findCalibrationClients(db, new Date("2026-05-12T10:00:00Z"))
    expect(items.map((i) => i.clientId)).toEqual(["client-b", "client-a"])
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

```
npm test -- src/lib/admin/__tests__/attention.test.ts
```
Expected: 4 new failures.

- [ ] **Step 3: Implement `findCalibrationClients`**

Add (next to other find* functions):

```ts
export async function findCalibrationClients(
  db: Db,
  now: Date
): Promise<CalibrationItem[]> {
  const since = new Date(now.getTime() - SEVEN_DAYS_MS)
  const rows = await db
    .select({
      clientId: schema.clients.id,
      businessName: schema.clients.businessName,
      joinedAt: schema.clients.createdAt,
      postCount: sql<number>`count(${schema.posts.id})::int`,
    })
    .from(schema.clients)
    .leftJoin(schema.posts, eq(schema.posts.clientId, schema.clients.id))
    .where(sql`${schema.clients.createdAt} > ${since}`)
    .groupBy(schema.clients.id, schema.clients.businessName, schema.clients.createdAt)
    .orderBy(asc(schema.clients.createdAt))

  return rows.map((r) => ({
    clientId: r.clientId,
    businessName: r.businessName,
    joinedAt: r.joinedAt,
    postCount: Number(r.postCount),
  }))
}
```

Wire into combiner:
```ts
calibrationClients: await findCalibrationClients(db, now),
```

- [ ] **Step 4: Run tests, verify they pass**

```
npm test -- src/lib/admin/__tests__/attention.test.ts
```
Expected: 27 passing.

- [ ] **Step 5: Commit**

```
git add src/lib/admin/attention.ts src/lib/admin/__tests__/attention.test.ts
git commit -m "feat(admin): add findCalibrationClients query for attention list"
```

---

## Task 9: Integration test for getAttentionData

This task adds a single end-to-end test that seeds a realistic mixture of signals across two clients and asserts the combiner returns the correct partitioning.

**Files:**
- Modify: `src/lib/admin/__tests__/attention.test.ts`

- [ ] **Step 1: Write the integration test**

Append:

```ts
describe("getAttentionData (integration)", () => {
  it("partitions a realistic mix of signals into the right sections", async () => {
    const now = new Date("2026-05-12T10:00:00Z")

    // Client A — older client with mixed problems.
    await seedTestClient(db, "client-a")
    await db.update(clientsTable)
      .set({ createdAt: new Date("2026-04-01T10:00:00Z") })
      .where(eq(clientsTable.id, "client-a"))

    // Client B — calibration (joined 2 days ago, 0 posts).
    await seedTestClient(db, "client-b")
    await db.update(clientsTable)
      .set({ createdAt: new Date("2026-05-10T10:00:00Z") })
      .where(eq(clientsTable.id, "client-b"))

    // Seed three posts for client A.
    await insertPosts(db, [
      { clientId: "client-a", platform: "instagram", scheduledDate: "2026-05-10", content: "stale draft", reasoning: "n/a" },
      { clientId: "client-a", platform: "facebook",  scheduledDate: "2026-05-08", content: "rejected last week", reasoning: "n/a" },
      { clientId: "client-a", platform: "instagram", scheduledDate: "2026-05-11", content: "approved but overdue", reasoning: "n/a" },
    ])
    const rows = await db.select().from(posts).where(eq(posts.clientId, "client-a"))
    const byContent = (s: string) => rows.find((p) => p.content === s)!.id

    await db.update(posts)
      .set({ alertedAt: new Date("2026-05-12T05:00:00Z"), firstSeenAt: new Date("2026-05-11T05:00:00Z") })
      .where(eq(posts.id, byContent("stale draft")))
    await db.update(posts)
      .set({ status: "rejected", rejectedAt: new Date("2026-05-09T10:00:00Z") })
      .where(eq(posts.id, byContent("rejected last week")))
    await db.update(posts)
      .set({
        status: "approved",
        approvedAt: new Date("2026-05-10T10:00:00Z"),
        publishAt: new Date("2026-05-11T09:00:00Z"),
      })
      .where(eq(posts.id, byContent("approved but overdue")))

    const data = await getAttentionData(db, now)

    expect(data.staleDrafts.map((i) => i.postId)).toEqual([byContent("stale draft")])
    expect(data.recentRejections.map((i) => i.postId)).toEqual([byContent("rejected last week")])
    expect(data.overduePosts.map((i) => i.postId)).toEqual([byContent("approved but overdue")])
    expect(data.calibrationClients.map((i) => i.clientId)).toEqual(["client-b"])
    expect(data.failedPosts).toEqual([])
    expect(data.regenLimitHits).toEqual([])
    // The stale post does not also appear as unseen (firstSeenAt is set).
    expect(data.unseenDrafts).toEqual([])
  })
})
```

- [ ] **Step 2: Run test, verify it passes**

```
npm test -- src/lib/admin/__tests__/attention.test.ts
```
Expected: 28 passing. The combiner is already wired up from the previous tasks, so this should pass without further code changes. If it fails, debug before continuing.

- [ ] **Step 3: Run the full test suite**

```
npm test
```
Expected: all tests green (163 base + 28 attention = 191).

- [ ] **Step 4: Commit**

```
git add src/lib/admin/__tests__/attention.test.ts
git commit -m "test(admin): add integration test for getAttentionData combiner"
```

---

## Task 10: Operator-console CSS tokens

This task creates the small palette of CSS custom properties used by the Attention List. Kept in its own file so the admin layout imports tokens without dragging in unrelated styles.

**Files:**
- Create: `src/styles/admin-tokens.css`

- [ ] **Step 1: Create the tokens file**

Create `src/styles/admin-tokens.css`:

```css
/*
 * Operator-console palette for /admin/*.
 * Sober, dense, near-white. Severity colors are traffic-light only —
 * everything else is grayscale.
 */

.admin-shell {
  --admin-bg: #fafafa;
  --admin-surface: #ffffff;
  --admin-border: #e5e5e5;
  --admin-border-strong: #d4d4d4;

  --admin-text: #1a1a1a;
  --admin-text-muted: #525252;
  --admin-text-subtle: #737373;

  --admin-accent: #0a0a0a;

  /* Severity */
  --admin-sev-critical: #b91c1c; /* red — failed, overdue */
  --admin-sev-warn: #b45309;     /* amber — stale, regen-limit */
  --admin-sev-info: #404040;     /* dark gray — unseen, rejected */
  --admin-sev-soft: #737373;     /* gray — calibration */

  background-color: var(--admin-bg);
  color: var(--admin-text);
  font-family: var(--font-geist-sans), system-ui, -apple-system, sans-serif;
}

.admin-shell .admin-mono {
  font-family: var(--font-geist-mono), ui-monospace, "SF Mono", Menlo, monospace;
}
```

- [ ] **Step 2: Verify the file lints**

Run:
```
npx tsc --noEmit
```
Expected: zero errors (CSS is not type-checked but tsc should still complete on the rest of the project).

- [ ] **Step 3: Commit**

```
git add src/styles/admin-tokens.css
git commit -m "feat(admin): add operator-console CSS tokens for /admin/*"
```

---

## Task 11: AttentionSection component

**Files:**
- Create: `src/components/admin/attention-section.tsx`

- [ ] **Step 1: Implement the section wrapper**

Create `src/components/admin/attention-section.tsx`:

```tsx
import type { ReactNode } from "react"

interface AttentionSectionProps {
  title: string
  count: number
  severity: "critical" | "warn" | "info" | "soft"
  emptyMessage: string
  children: ReactNode
}

const severityColor: Record<AttentionSectionProps["severity"], string> = {
  critical: "var(--admin-sev-critical)",
  warn: "var(--admin-sev-warn)",
  info: "var(--admin-sev-info)",
  soft: "var(--admin-sev-soft)",
}

export default function AttentionSection({
  title,
  count,
  severity,
  emptyMessage,
  children,
}: AttentionSectionProps) {
  return (
    <section
      aria-labelledby={`section-${title}`}
      style={{
        borderTop: "1px solid var(--admin-border)",
        padding: "16px 0",
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", gap: "12px", marginBottom: "8px" }}>
        <h2
          id={`section-${title}`}
          style={{
            fontSize: "13px",
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--admin-text)",
            margin: 0,
          }}
        >
          {title}
        </h2>
        <span
          className="admin-mono"
          style={{
            fontSize: "12px",
            color: count === 0 ? "var(--admin-text-subtle)" : severityColor[severity],
            fontWeight: 500,
          }}
        >
          [{count}]
        </span>
      </header>

      {count === 0 ? (
        <p
          style={{
            fontSize: "13px",
            color: "var(--admin-text-subtle)",
            margin: 0,
          }}
        >
          {emptyMessage}
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {children}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Commit**

```
git add src/components/admin/attention-section.tsx
git commit -m "feat(admin): add AttentionSection presentational component"
```

---

## Task 12: AttentionItem component

**Files:**
- Create: `src/components/admin/attention-item.tsx`

- [ ] **Step 1: Implement the post-anchored row**

Create `src/components/admin/attention-item.tsx`:

```tsx
import Link from "next/link"
import type { AttentionItem as AttentionItemData } from "@/lib/admin/attention"

interface AttentionItemRowProps {
  item: AttentionItemData
  now: Date
}

const platformLabel: Record<"instagram" | "facebook", string> = {
  instagram: "IG",
  facebook: "FB",
}

/** Compact age expressed in the largest unit that fits: 12m, 3h, 2d. */
function formatAge(signalAt: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - signalAt.getTime())
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export default function AttentionItemRow({ item, now }: AttentionItemRowProps) {
  const href = `/admin/clients/${item.clientId}`
  const age = formatAge(item.signalAt, now)
  return (
    <li
      style={{
        borderBottom: "1px solid var(--admin-border)",
        padding: "10px 0",
      }}
    >
      <Link
        href={href}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          alignItems: "center",
          gap: "12px",
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
            <span style={{ fontSize: "14px", fontWeight: 500 }}>
              {item.businessName}
            </span>
            <span
              className="admin-mono"
              style={{
                fontSize: "11px",
                color: "var(--admin-text-subtle)",
                letterSpacing: "0.04em",
              }}
            >
              {platformLabel[item.platform]} · {item.scheduledDate}
            </span>
          </div>
          <p
            style={{
              fontSize: "13px",
              color: "var(--admin-text-muted)",
              margin: "2px 0 0",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.contentPreview}
          </p>
        </div>
        <span
          className="admin-mono"
          style={{
            fontSize: "12px",
            color: "var(--admin-text-muted)",
            whiteSpace: "nowrap",
          }}
          aria-label={`Signal age ${age}`}
        >
          {age} →
        </span>
      </Link>
    </li>
  )
}
```

- [ ] **Step 2: Commit**

```
git add src/components/admin/attention-item.tsx
git commit -m "feat(admin): add AttentionItem row component"
```

---

## Task 13: CalibrationItem component

**Files:**
- Create: `src/components/admin/calibration-item.tsx`

- [ ] **Step 1: Implement the client-anchored row**

Create `src/components/admin/calibration-item.tsx`:

```tsx
import Link from "next/link"
import type { CalibrationItem as CalibrationItemData } from "@/lib/admin/attention"

interface CalibrationItemRowProps {
  item: CalibrationItemData
  now: Date
}

function formatDaysSince(joinedAt: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - joinedAt.getTime())
  const days = Math.floor(ms / (24 * 60 * 60 * 1000))
  if (days === 0) return "vandaag"
  if (days === 1) return "1 dag geleden"
  return `${days} dagen geleden`
}

export default function CalibrationItemRow({ item, now }: CalibrationItemRowProps) {
  const href = `/admin/clients/${item.clientId}`
  return (
    <li
      style={{
        borderBottom: "1px solid var(--admin-border)",
        padding: "10px 0",
      }}
    >
      <Link
        href={href}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          alignItems: "center",
          gap: "12px",
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
            <span style={{ fontSize: "14px", fontWeight: 500 }}>
              {item.businessName}
            </span>
            <span
              className="admin-mono"
              style={{
                fontSize: "11px",
                color: "var(--admin-text-subtle)",
                letterSpacing: "0.04em",
              }}
            >
              {formatDaysSince(item.joinedAt, now)} · {item.postCount} posts
            </span>
          </div>
          <p
            style={{
              fontSize: "13px",
              color: "var(--admin-text-muted)",
              margin: "2px 0 0",
            }}
          >
            {item.postCount === 0
              ? "Nog geen posts gegenereerd — overweeg een eerste week aan te zetten."
              : "Recent gestart — kijk of de eerste lichting matcht met het merk."}
          </p>
        </div>
        <span
          className="admin-mono"
          style={{
            fontSize: "12px",
            color: "var(--admin-text-muted)",
            whiteSpace: "nowrap",
          }}
          aria-hidden="true"
        >
          →
        </span>
      </Link>
    </li>
  )
}
```

- [ ] **Step 2: Commit**

```
git add src/components/admin/calibration-item.tsx
git commit -m "feat(admin): add CalibrationItem row component"
```

---

## Task 14: Admin nav header

**Files:**
- Create: `src/components/admin/admin-nav.tsx`

- [ ] **Step 1: Implement the nav strip**

Create `src/components/admin/admin-nav.tsx`:

```tsx
import Link from "next/link"
import SignOutButton from "@/components/sign-out-button"

const links = [
  { href: "/admin", label: "Attention" },
  { href: "/admin/clients", label: "Clients" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/generate-preview", label: "Generate" },
]

export default function AdminNav() {
  return (
    <nav
      aria-label="Admin"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 32px",
        borderBottom: "1px solid var(--admin-border-strong)",
        backgroundColor: "var(--admin-surface)",
      }}
    >
      <ul style={{
        display: "flex",
        gap: "24px",
        listStyle: "none",
        margin: 0,
        padding: 0,
      }}>
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              style={{
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--admin-text)",
                textDecoration: "none",
                letterSpacing: "0.02em",
              }}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
      <SignOutButton label="Sign out" />
    </nav>
  )
}
```

- [ ] **Step 2: Commit**

```
git add src/components/admin/admin-nav.tsx
git commit -m "feat(admin): add AdminNav header strip"
```

---

## Task 15: Admin layout (tokens + nav for all /admin/* pages)

**Files:**
- Create: `src/app/admin/layout.tsx`

This wraps every page under `/admin` with the operator-console shell. It also runs the admin guard so individual pages don't have to re-implement it (we keep the per-page checks too for defense-in-depth — removing them is out of scope).

- [ ] **Step 1: Create the admin layout**

Create `src/app/admin/layout.tsx`:

```tsx
import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import AdminNav from "@/components/admin/admin-nav"
import "@/styles/admin-tokens.css"

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    redirect("/login")
  }

  return (
    <div className="admin-shell" style={{ minHeight: "100vh" }}>
      <AdminNav />
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Build to confirm no regressions**

Run:
```
npm run build
```
Expected: build completes successfully.

- [ ] **Step 3: Commit**

```
git add src/app/admin/layout.tsx
git commit -m "feat(admin): wrap /admin/* in operator-console layout with nav"
```

---

## Task 16: Move user table to /admin/users

**Files:**
- Create: `src/app/admin/users/page.tsx`

The existing `src/app/admin/page.tsx` becomes the Attention List in the next task, so we copy the user-table contents to a new page first. Imports change to reference the existing `DeleteUserButton` from `../delete-user-button`.

- [ ] **Step 1: Create the users page**

Create `src/app/admin/users/page.tsx`:

```tsx
import { db } from "@/db"
import { users } from "@/db/schema"
import DeleteUserButton from "../delete-user-button"

export default async function AdminUsersPage() {
  // Auth + role gate handled by /admin/layout.tsx.
  const allUsers = await db.select().from(users)

  return (
    <main style={{ padding: "32px", maxWidth: "800px" }}>
      <h1 style={{ fontSize: "20px", marginBottom: "24px", letterSpacing: "0.02em" }}>
        Users
      </h1>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--admin-border-strong)", textAlign: "left" }}>
            <th style={{ padding: "8px", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Email</th>
            <th style={{ padding: "8px", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Role</th>
            <th style={{ padding: "8px", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Logged in</th>
            <th style={{ padding: "8px" }}></th>
          </tr>
        </thead>
        <tbody>
          {allUsers.map((u) => (
            <tr key={u.id} style={{ borderBottom: "1px solid var(--admin-border)" }}>
              <td style={{ padding: "8px", fontSize: "13px" }}>{u.email}</td>
              <td style={{ padding: "8px", fontSize: "13px" }}>{u.role}</td>
              <td style={{ padding: "8px", fontSize: "13px" }}>{u.hasLoggedIn ? "Yes" : "No"}</td>
              <td style={{ padding: "8px" }}>
                {u.role !== "admin" && (
                  <DeleteUserButton userId={u.id} userEmail={u.email} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
```

- [ ] **Step 2: Build to confirm**

```
npm run build
```
Expected: build green, route `/admin/users` registered.

- [ ] **Step 3: Commit**

```
git add src/app/admin/users/page.tsx
git commit -m "feat(admin): add /admin/users page for the legacy user table"
```

---

## Task 17: Replace /admin with the Attention List

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Replace the page**

Overwrite `src/app/admin/page.tsx`:

```tsx
import { db } from "@/db"
import { getAttentionData } from "@/lib/admin/attention"
import AttentionSection from "@/components/admin/attention-section"
import AttentionItemRow from "@/components/admin/attention-item"
import CalibrationItemRow from "@/components/admin/calibration-item"

export default async function AdminAttentionPage() {
  // Auth + role gate handled by /admin/layout.tsx.
  const now = new Date()
  const data = await getAttentionData(db, now)

  return (
    <main
      style={{
        padding: "32px",
        maxWidth: "960px",
        margin: "0 auto",
      }}
    >
      <header style={{ marginBottom: "12px" }}>
        <h1 style={{ fontSize: "20px", margin: 0, letterSpacing: "0.02em" }}>
          Attention
        </h1>
        <p
          style={{
            fontSize: "13px",
            color: "var(--admin-text-subtle)",
            margin: "4px 0 0",
          }}
        >
          Wat vraagt nu om je aandacht, over alle klanten heen.
        </p>
      </header>

      <AttentionSection
        title="Failed to publish"
        count={data.failedPosts.length}
        severity="critical"
        emptyMessage="Geen publish-fouten."
      >
        {data.failedPosts.map((item) => (
          <AttentionItemRow key={item.postId} item={item} now={now} />
        ))}
      </AttentionSection>

      <AttentionSection
        title="Overdue"
        count={data.overduePosts.length}
        severity="critical"
        emptyMessage="Niets achterstallig."
      >
        {data.overduePosts.map((item) => (
          <AttentionItemRow key={item.postId} item={item} now={now} />
        ))}
      </AttentionSection>

      <AttentionSection
        title="Stale drafts"
        count={data.staleDrafts.length}
        severity="warn"
        emptyMessage="Geen drafts die te lang stilliggen."
      >
        {data.staleDrafts.map((item) => (
          <AttentionItemRow key={item.postId} item={item} now={now} />
        ))}
      </AttentionSection>

      <AttentionSection
        title="Regen limit hit"
        count={data.regenLimitHits.length}
        severity="warn"
        emptyMessage="Geen klanten vastgelopen op de regen-limit."
      >
        {data.regenLimitHits.map((item) => (
          <AttentionItemRow key={item.postId} item={item} now={now} />
        ))}
      </AttentionSection>

      <AttentionSection
        title="Unseen drafts"
        count={data.unseenDrafts.length}
        severity="info"
        emptyMessage="Iedereen heeft z'n drafts gezien."
      >
        {data.unseenDrafts.map((item) => (
          <AttentionItemRow key={item.postId} item={item} now={now} />
        ))}
      </AttentionSection>

      <AttentionSection
        title="Recent rejections"
        count={data.recentRejections.length}
        severity="info"
        emptyMessage="Geen afwijzingen de afgelopen 7 dagen."
      >
        {data.recentRejections.map((item) => (
          <AttentionItemRow key={item.postId} item={item} now={now} />
        ))}
      </AttentionSection>

      <AttentionSection
        title="Calibration"
        count={data.calibrationClients.length}
        severity="soft"
        emptyMessage="Geen nieuwe klanten in calibratie."
      >
        {data.calibrationClients.map((item) => (
          <CalibrationItemRow key={item.clientId} item={item} now={now} />
        ))}
      </AttentionSection>
    </main>
  )
}
```

- [ ] **Step 2: Build to confirm**

```
npm run build
```
Expected: build green.

- [ ] **Step 3: Typecheck**

```
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Full test suite still green**

```
npm test
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```
git add src/app/admin/page.tsx
git commit -m "feat(admin): replace /admin with attention list"
```

---

## Task 18: Final verification + push

**Files:** none

- [ ] **Step 1: Run full test suite**

```
npm test
```
Expected: all green.

- [ ] **Step 2: Run typecheck**

```
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Run production build**

```
npm run build
```
Expected: build completes; new routes `/admin`, `/admin/users` listed.

- [ ] **Step 4: Push the branch**

```
git push -u origin feat/attention-list
```
Expected: branch pushed; URL to open a PR is printed.

- [ ] **Step 5: Write the PR body draft**

Create `.pr-body-attention-list.md` at the repo root:

```markdown
# Owner Attention List

Replaces the bare user table at `/admin` with an Operator-Console attention list that surfaces, in urgency order, every post or client signal that Stefan needs to act on. The old user table moves to `/admin/users`.

## What's new

- `src/lib/admin/attention.ts` — aggregation queries (one per signal) plus a `getAttentionData(db, now)` combiner. No new tables; existing alert columns (`alertedAt`, `regenLimitAlertedAt`, `firstSeenAt`, `publishError`, etc.) drive the page.
- `src/lib/admin/__tests__/attention.test.ts` — Vitest + PGlite, one `describe` per section + an integration test for the combiner (28 tests).
- `src/app/admin/page.tsx` — replaced. Now the Attention List.
- `src/app/admin/users/page.tsx` — old user table moved here.
- `src/app/admin/layout.tsx` — shared admin shell (auth gate + nav + operator-console tokens).
- `src/components/admin/{attention-section,attention-item,calibration-item,admin-nav}.tsx` — presentational components.
- `src/styles/admin-tokens.css` — operator-console palette.

## Why

Spec `docs/superpowers/specs/2026-05-12-attention-list-design.md` (Aesthetic Option A, locked).

The old `/admin` page was a raw users table — useful at zero clients, useless at five. Stefan needs one screen that answers "what fires need putting out before my 10am call." All the data was already stamped onto rows by the alert crons and the regen flow; this PR only adds the read path.

## Sections (in urgency order)

1. Failed to publish — `status='failed' OR publishError IS NOT NULL`
2. Overdue — approved, `publishAt < now`, not yet published
3. Stale drafts — `alertedAt IS NOT NULL` and still draft
4. Regen limit hit — `regenLimitAlertedAt IS NOT NULL` and still draft
5. Unseen drafts — `status='draft' AND firstSeenAt IS NULL`
6. Recent rejections — rejected in the last 7 days
7. Calibration — clients created in the last 7 days, with their post count

## Test plan

- [ ] `npm test` — all tests green
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npm run build` — production build green
- [ ] Smoke: sign in as admin → `/admin` renders → each section shows the correct count for the seeded data
- [ ] Smoke: `/admin/users` shows the same user table that was previously at `/admin`
- [ ] Smoke: nav links route correctly between Attention / Clients / Users / Generate

## Out of scope

- Inline actions on rows (approve/reject/cancel happen on the client page)
- Search / filter / pagination
- Configurable thresholds, snooze/dismiss, per-client roll-ups
- Refactoring the duplicated `Db` type alias (separate follow-up branch)
- Visual indexes for the unseen-drafts and regen-limit queries (revisit if EXPLAIN ANALYZE shows them slow)
```

- [ ] **Step 6: Commit the PR body draft**

```
git add .pr-body-attention-list.md
git commit -m "docs: PR body draft for attention-list"
git push
```

---

## Self-Review Notes

- **Spec coverage.** Every section from §3b is implemented (Tasks 2–8). §3a Operator Console is realized via `admin-tokens.css` + Geist Mono usage. §3c file map matches the file map at the top of this plan. §3d type shapes match the types defined in Task 1. §3e — no new indexes added, as recommended.
- **Placeholder scan.** No "TBD" / "implement later" / "similar to" placeholders. Every step contains the actual code or command.
- **Type consistency.** `AttentionItem` and `CalibrationItem` defined in Task 1 are used unchanged in Tasks 2–8 and the components in Tasks 12–13. Function names match between definition and import sites (`findFailedPosts`, `findOverduePosts`, `findStaleDrafts`, `findRegenLimitHits`, `findUnseenDrafts`, `findRecentRejections`, `findCalibrationClients`, `getAttentionData`).
- **Test imports.** Each task that adds tests adds a single new `import` line — this is intentional (the test file grows incrementally and each commit is bite-sized). The completed file ends with all imports near the top, which we accept; linting may warn but won't fail. If lint does fail at the end, fix in Task 18 Step 2 typecheck step.
- **Drizzle import surface.** Task 2 imports `and, asc, eq, isNotNull, or, sql`; Task 3 adds `isNull`; later tasks re-use these. The implementing agent should consolidate the import block as new operators are added, never duplicate import statements.

---
