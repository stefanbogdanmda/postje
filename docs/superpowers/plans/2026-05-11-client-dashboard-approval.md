# Client Dashboard & Approval UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the client-facing dashboard and post approval workflow so clients can log in, review generated posts, approve/edit/reject them, and request regeneration.

**Architecture:** Server component dashboard fetches posts and renders three sections (pending, upcoming, published). Client components handle interactivity: card clicks open a slide-over panel with platform preview + editable caption + action buttons. Server actions handle approve/reject/regenerate mutations. Single-post regeneration uses Claude's writing phase only (no re-planning).

**Tech Stack:** Next.js App Router, React server/client components, Tailwind CSS, Drizzle ORM, Claude API (Anthropic SDK), Vitest

**Spec:** `docs/superpowers/specs/2026-05-11-client-dashboard-approval-design.md`

---

### Task 1: Repository — getPostById, approvePost, rejectPost, regeneratePost

**Files:**
- Modify: `src/lib/posts/repository.ts`
- Test: `src/lib/posts/__tests__/repository.test.ts`

- [ ] **Step 1: Write failing tests for getPostById**

Add to the existing test file `src/lib/posts/__tests__/repository.test.ts`:

```typescript
import {
  getPostById,
  approvePost,
  rejectPost,
  regeneratePost,
} from "../repository"

describe("getPostById", () => {
  it("returns a post matching both id and clientId", () => {
    const clientId = seedTestClient(db)
    insertPosts(db, [
      {
        clientId,
        platform: "instagram",
        scheduledDate: "2026-05-12",
        content: "Test post",
        reasoning: "test",
      },
    ])
    const allPosts = getPostsByDateRange(db, clientId, "2026-05-12", "2026-05-12")
    const post = getPostById(db, allPosts[0].id, clientId)
    expect(post).not.toBeNull()
    expect(post!.content).toBe("Test post")
  })

  it("returns null when clientId does not match", () => {
    const clientId = seedTestClient(db)
    const otherClientId = seedTestClient(db, "other-client")
    insertPosts(db, [
      {
        clientId,
        platform: "instagram",
        scheduledDate: "2026-05-12",
        content: "Private post",
        reasoning: "test",
      },
    ])
    const allPosts = getPostsByDateRange(db, clientId, "2026-05-12", "2026-05-12")
    const post = getPostById(db, allPosts[0].id, otherClientId)
    expect(post).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/posts/__tests__/repository.test.ts`
Expected: FAIL — `getPostById` is not exported

- [ ] **Step 3: Implement getPostById**

Add to `src/lib/posts/repository.ts`:

```typescript
/**
 * Get a single post by ID, filtered by clientId for ownership check.
 * Returns null if the post doesn't exist or doesn't belong to this client.
 */
export function getPostById(
  db: Db,
  postId: string,
  clientId: string
): Post | null {
  const row = db
    .select()
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.id, postId),
        eq(schema.posts.clientId, clientId)
      )
    )
    .get()
  return (row as Post) ?? null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/posts/__tests__/repository.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for approvePost**

Add to the same test file:

```typescript
describe("approvePost", () => {
  it("sets status to approved and sets approvedAt", () => {
    const clientId = seedTestClient(db)
    insertPosts(db, [
      {
        clientId,
        platform: "instagram",
        scheduledDate: "2026-05-12",
        content: "Draft post",
        reasoning: "test",
      },
    ])
    const allPosts = getPostsByDateRange(db, clientId, "2026-05-12", "2026-05-12")
    const result = approvePost(db, allPosts[0].id, clientId)
    expect(result.status).toBe("approved")
    expect(result.approvedAt).not.toBeNull()
    expect(result.content).toBe("Draft post")
  })

  it("updates content when new content is provided", () => {
    const clientId = seedTestClient(db)
    insertPosts(db, [
      {
        clientId,
        platform: "instagram",
        scheduledDate: "2026-05-12",
        content: "Original text",
        reasoning: "test",
      },
    ])
    const allPosts = getPostsByDateRange(db, clientId, "2026-05-12", "2026-05-12")
    const result = approvePost(db, allPosts[0].id, clientId, "Edited text")
    expect(result.status).toBe("approved")
    expect(result.content).toBe("Edited text")
  })

  it("throws when post does not belong to client", () => {
    const clientId = seedTestClient(db)
    const otherClientId = seedTestClient(db, "other-client")
    insertPosts(db, [
      {
        clientId,
        platform: "instagram",
        scheduledDate: "2026-05-12",
        content: "test",
        reasoning: "test",
      },
    ])
    const allPosts = getPostsByDateRange(db, clientId, "2026-05-12", "2026-05-12")
    expect(() => approvePost(db, allPosts[0].id, otherClientId)).toThrow()
  })
})
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run src/lib/posts/__tests__/repository.test.ts`
Expected: FAIL — `approvePost` is not exported

- [ ] **Step 7: Implement approvePost**

Add to `src/lib/posts/repository.ts`:

```typescript
/**
 * Approve a draft post. Optionally update its content (for "approve with edits").
 * Sets status to "approved", records approvedAt timestamp.
 * Throws if the post doesn't exist, doesn't belong to this client, or isn't a draft.
 */
export function approvePost(
  db: Db,
  postId: string,
  clientId: string,
  newContent?: string
): Post {
  const post = getPostById(db, postId, clientId)
  if (!post) {
    throw new Error("Post not found or access denied")
  }
  if (post.status !== "draft") {
    throw new Error(`Cannot approve a post with status "${post.status}"`)
  }

  const now = new Date()
  const updates: Record<string, unknown> = {
    status: "approved",
    approvedAt: now,
    updatedAt: now,
  }
  if (newContent !== undefined) {
    updates.content = newContent
  }

  db.update(schema.posts)
    .set(updates)
    .where(
      and(
        eq(schema.posts.id, postId),
        eq(schema.posts.clientId, clientId)
      )
    )
    .run()

  return getPostById(db, postId, clientId)!
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/lib/posts/__tests__/repository.test.ts`
Expected: PASS

- [ ] **Step 9: Write failing tests for rejectPost**

```typescript
describe("rejectPost", () => {
  it("sets status to rejected and increments rejectionCount", () => {
    const clientId = seedTestClient(db)
    insertPosts(db, [
      {
        clientId,
        platform: "instagram",
        scheduledDate: "2026-05-12",
        content: "Draft post",
        reasoning: "test",
      },
    ])
    const allPosts = getPostsByDateRange(db, clientId, "2026-05-12", "2026-05-12")
    const result = rejectPost(db, allPosts[0].id, clientId)
    expect(result.status).toBe("rejected")
    expect(result.rejectedAt).not.toBeNull()
    expect(result.rejectionCount).toBe(1)
  })
})
```

- [ ] **Step 10: Implement rejectPost**

```typescript
/**
 * Reject (skip) a draft post.
 * Sets status to "rejected", records rejectedAt, increments rejectionCount.
 * Throws if the post doesn't exist, doesn't belong to this client, or isn't a draft.
 */
export function rejectPost(
  db: Db,
  postId: string,
  clientId: string
): Post {
  const post = getPostById(db, postId, clientId)
  if (!post) {
    throw new Error("Post not found or access denied")
  }
  if (post.status !== "draft") {
    throw new Error(`Cannot reject a post with status "${post.status}"`)
  }

  const now = new Date()
  db.update(schema.posts)
    .set({
      status: "rejected",
      rejectedAt: now,
      rejectionCount: post.rejectionCount + 1,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.posts.id, postId),
        eq(schema.posts.clientId, clientId)
      )
    )
    .run()

  return getPostById(db, postId, clientId)!
}
```

- [ ] **Step 11: Write failing tests for regeneratePost**

```typescript
describe("regeneratePost", () => {
  it("updates content in place and increments rejectionCount", () => {
    const clientId = seedTestClient(db)
    insertPosts(db, [
      {
        clientId,
        platform: "instagram",
        scheduledDate: "2026-05-12",
        content: "Old content",
        reasoning: "original reasoning",
      },
    ])
    const allPosts = getPostsByDateRange(db, clientId, "2026-05-12", "2026-05-12")
    const postId = allPosts[0].id

    const result = regeneratePost(db, postId, clientId, "New content", "new reasoning")
    expect(result.id).toBe(postId)
    expect(result.content).toBe("New content")
    expect(result.reasoning).toBe("new reasoning")
    expect(result.rejectionCount).toBe(1)
    expect(result.status).toBe("draft")
  })
})
```

- [ ] **Step 12: Implement regeneratePost**

```typescript
/**
 * Update a post in place with new AI-generated content.
 * Keeps the same row ID, increments rejectionCount, resets status to draft.
 * Throws if the post doesn't exist or doesn't belong to this client.
 */
export function regeneratePost(
  db: Db,
  postId: string,
  clientId: string,
  newContent: string,
  newReasoning: string
): Post {
  const post = getPostById(db, postId, clientId)
  if (!post) {
    throw new Error("Post not found or access denied")
  }

  const now = new Date()
  db.update(schema.posts)
    .set({
      content: newContent,
      reasoning: newReasoning,
      status: "draft",
      rejectionCount: post.rejectionCount + 1,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.posts.id, postId),
        eq(schema.posts.clientId, clientId)
      )
    )
    .run()

  return getPostById(db, postId, clientId)!
}
```

- [ ] **Step 13: Run all repository tests**

Run: `npx vitest run src/lib/posts/__tests__/repository.test.ts`
Expected: ALL PASS

- [ ] **Step 14: Commit**

```bash
git add src/lib/posts/repository.ts src/lib/posts/__tests__/repository.test.ts
git commit -m "feat: add getPostById, approvePost, rejectPost, regeneratePost to repository"
```

---

### Task 2: Server Actions — approve, reject, regenerate

**Files:**
- Create: `src/lib/posts/actions.ts`

This file uses Next.js server actions (`"use server"`) to handle mutations from the client dashboard. Each action validates the session, resolves the `clientId` from the `userId`, and calls the repository.

- [ ] **Step 1: Create the server actions file**

Create `src/lib/posts/actions.ts`:

```typescript
"use server"

import { auth } from "@/lib/auth"
import { db } from "@/db"
import { eq } from "drizzle-orm"
import { clients } from "@/db/schema"
import {
  getPostById,
  approvePost as repoApprovePost,
  rejectPost as repoRejectPost,
  regeneratePost as repoRegeneratePost,
} from "./repository"
import { regenerateSinglePost } from "@/lib/ai/regenerate-post"
import { MAX_REJECTIONS } from "./config"
import type { Post } from "./types"

interface ActionResult {
  success: boolean
  post?: Post
  error?: string
}

/**
 * Resolve the clientId for the currently logged-in user.
 * Returns null if the user has no client profile (e.g., admin users).
 */
async function getClientIdForSession(): Promise<string | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const client = db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.userId, session.user.id))
    .get()

  return client?.id ?? null
}

export async function approvePostAction(
  postId: string,
  editedContent?: string
): Promise<ActionResult> {
  const clientId = await getClientIdForSession()
  if (!clientId) {
    return { success: false, error: "Niet ingelogd" }
  }

  try {
    const post = repoApprovePost(db, postId, clientId, editedContent)
    return { success: true, post }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Onbekende fout"
    return { success: false, error: message }
  }
}

export async function rejectPostAction(
  postId: string
): Promise<ActionResult> {
  const clientId = await getClientIdForSession()
  if (!clientId) {
    return { success: false, error: "Niet ingelogd" }
  }

  try {
    const post = repoRejectPost(db, postId, clientId)
    return { success: true, post }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Onbekende fout"
    return { success: false, error: message }
  }
}

export async function regeneratePostAction(
  postId: string,
  feedback: string
): Promise<ActionResult> {
  const clientId = await getClientIdForSession()
  if (!clientId) {
    return { success: false, error: "Niet ingelogd" }
  }

  if (!feedback || feedback.trim().length < 10) {
    return { success: false, error: "Feedback moet minimaal 10 tekens bevatten" }
  }

  const existingPost = getPostById(db, postId, clientId)
  if (!existingPost) {
    return { success: false, error: "Post niet gevonden" }
  }

  if (existingPost.rejectionCount >= MAX_REJECTIONS) {
    return {
      success: false,
      error: "Je hebt het maximum aantal wijzigingen bereikt. Neem contact op met Stefan.",
    }
  }

  try {
    const newContent = await regenerateSinglePost(
      existingPost,
      feedback,
      clientId
    )
    const post = repoRegeneratePost(
      db,
      postId,
      clientId,
      newContent.content,
      newContent.reasoning
    )
    return { success: true, post }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Onbekende fout"
    return { success: false, error: message }
  }
}
```

- [ ] **Step 2: Verify the file has no TypeScript errors**

Run: `npx tsc --noEmit --pretty false 2>&1 | head -20`

Note: This will show an error for `regenerate-post.ts` which doesn't exist yet — that's expected and will be created in Task 3.

- [ ] **Step 3: Commit**

```bash
git add src/lib/posts/actions.ts
git commit -m "feat: add server actions for approve, reject, regenerate"
```

---

### Task 3: Single-Post Regeneration — AI Module

**Files:**
- Create: `src/lib/ai/regenerate-post.ts`

This module calls Claude to regenerate a single post caption based on client feedback. Uses the writing phase only (no re-planning). Reuses the existing client profile and prompt style from `prompts.ts`.

- [ ] **Step 1: Create the regeneration module**

Create `src/lib/ai/regenerate-post.ts`:

```typescript
import { getAnthropicClient } from "./client"
import { extractJSON } from "./extract-json"
import { cafeDeHoek } from "@/data/clients/cafe-de-hoek"
import type { Post } from "@/lib/posts/types"

const MODEL = "claude-sonnet-4-6"

interface RegeneratedContent {
  content: string
  reasoning: string
}

/**
 * Regenerate a single post caption based on client feedback.
 * Uses only the writing phase — no re-planning needed for a single post.
 *
 * Returns the new content and reasoning. Does NOT write to the database —
 * the caller handles persistence via the repository.
 */
export async function regenerateSinglePost(
  existingPost: Post,
  feedback: string,
  _clientId: string
): Promise<RegeneratedContent> {
  // TODO(v2): Load client profile from DB by clientId instead of hardcoded import
  const client = cafeDeHoek

  const anthropic = getAnthropicClient()

  const systemPrompt = `You are ${client.ownerPersona.name}, the owner of ${client.name} in ${client.location}. You are rewriting a social media post based on client feedback.

Voice rules:
- ${client.ownerPersona.style}
- Write in Dutch.
- No sentence over 15 words. Count before you write. This is a hard rule, not a suggestion.
- Use emojis sparingly — one or two per post maximum, only ☕ and 🌿 style (warm, natural).
- Never use these phrases: ${client.bannedPhrases.map((p) => `"${p}"`).join(", ")}

Respond with valid JSON only. No markdown, no explanation outside the JSON.`

  const userPrompt = `Rewrite this ${existingPost.platform} post for ${client.name}.

CURRENT POST:
${existingPost.content}

CLIENT FEEDBACK (what they want changed):
${feedback}

Write a new version that addresses the feedback while keeping the same general topic and day.

Respond with this exact JSON structure:
{
  "content": "The new Dutch post text",
  "reasoning": "English explanation of what you changed and why"
}`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  })

  const textBlock = response.content.find((b) => b.type === "text")
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in regeneration response")
  }

  return extractJSON<RegeneratedContent>(textBlock.text)
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty false 2>&1 | head -20`
Expected: No errors (or only unrelated warnings)

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/regenerate-post.ts
git commit -m "feat: add single-post regeneration module"
```

---

### Task 4: Dashboard Layout and Server Component

**Files:**
- Create: `src/app/dashboard/layout.tsx`
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Create the dashboard layout**

Create `src/app/dashboard/layout.tsx`:

```typescript
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { eq } from "drizzle-orm"
import { clients } from "@/db/schema"
import SignOutButton from "@/components/sign-out-button"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session) redirect("/login")

  // Resolve business name for the header
  const client = db
    .select({ businessName: clients.businessName })
    .from(clients)
    .where(eq(clients.userId, session.user.id))
    .get()

  if (!client) redirect("/login")

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <header className="bg-white border-b border-[#e5e5e5] px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs text-[#999] uppercase tracking-wider font-medium">
              Postje
            </p>
            <h1 className="text-lg font-semibold text-[#1a1a1a] mt-0.5">
              {client.businessName}
            </h1>
          </div>
          <SignOutButton label="Log uit" />
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-6">
        {children}
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Rewrite the dashboard page**

Rewrite `src/app/dashboard/page.tsx`:

```typescript
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { eq } from "drizzle-orm"
import { clients } from "@/db/schema"
import { getPostsByDateRange } from "@/lib/posts/repository"
import { PendingPosts } from "@/components/dashboard/pending-posts"
import { UpcomingPosts } from "@/components/dashboard/upcoming-posts"
import { PublishedPosts } from "@/components/dashboard/published-posts"
import type { Post } from "@/lib/posts/types"

/** Get Monday of the current week (ISO week starts Monday). */
function getCurrentWeekStart(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff)
  return monday.toISOString().split("T")[0]
}

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const client = db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.userId, session.user.id))
    .get()

  if (!client) redirect("/login")

  const weekStart = getCurrentWeekStart()
  const weekEnd = new Date(weekStart + "T00:00:00")
  weekEnd.setDate(weekEnd.getDate() + 6)
  const weekEndStr = weekEnd.toISOString().split("T")[0]

  const posts = getPostsByDateRange(db, client.id, weekStart, weekEndStr)

  const pendingPosts = posts.filter((p) => p.status === "draft")
  const approvedPosts = posts.filter((p) => p.status === "approved")
  const publishedPosts = posts.filter((p) => p.status === "published")

  return (
    <div className="space-y-8">
      <PendingPosts posts={pendingPosts} />
      <UpcomingPosts posts={approvedPosts} />
      <PublishedPosts posts={publishedPosts} />
    </div>
  )
}
```

- [ ] **Step 3: Verify the page compiles (will fail until components exist)**

Run: `npx tsc --noEmit --pretty false 2>&1 | head -20`
Expected: Errors about missing component imports — expected, created in Tasks 5-7

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/layout.tsx src/app/dashboard/page.tsx
git commit -m "feat: add dashboard layout and server component"
```

---

### Task 5: Pending Posts Section + Post Card Component

**Files:**
- Create: `src/components/dashboard/pending-posts.tsx`
- Create: `src/components/dashboard/post-card.tsx`

- [ ] **Step 1: Create the post card component**

Create `src/components/dashboard/post-card.tsx`:

```typescript
import type { Post } from "@/lib/posts/types"

interface PostCardProps {
  post: Post
  onClick: () => void
}

/** Format a date string like "2026-05-12" to "ma 12 mei" in Dutch. */
function formatDutchDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00")
  const days = ["zo", "ma", "di", "wo", "do", "vr", "za"]
  const months = [
    "jan", "feb", "mrt", "apr", "mei", "jun",
    "jul", "aug", "sep", "okt", "nov", "dec",
  ]
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`
}

function PlatformBadge({ platform }: { platform: string }) {
  const isInstagram = platform === "instagram"
  return (
    <span className="absolute top-2 right-2 bg-white px-2 py-0.5 rounded text-xs font-medium text-[#666] shadow-sm flex items-center gap-1">
      <span
        className="inline-block w-2 h-2 rounded-sm"
        style={{
          background: isInstagram
            ? "linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)"
            : "#1877f2",
        }}
      />
      {isInstagram ? "Instagram" : "Facebook"}
    </span>
  )
}

export function PostCard({ post, onClick }: PostCardProps) {
  // Use photo URL if available, otherwise show a placeholder gradient
  const hasPhoto = !!post.photoId

  return (
    <button
      onClick={onClick}
      className="bg-white border border-[#e5e5e5] rounded-xl overflow-hidden cursor-pointer text-left w-full hover:shadow-md transition-shadow"
    >
      <div className="relative h-32 bg-gradient-to-br from-[#f5f0e8] to-[#e8dcc8] flex items-center justify-center">
        {hasPhoto ? (
          <div className="text-4xl">📷</div>
        ) : (
          <div className="text-4xl">📝</div>
        )}
        <PlatformBadge platform={post.platform} />
      </div>
      <div className="p-3">
        <p className="text-sm text-[#333] leading-snug line-clamp-2">
          {post.content}
        </p>
        <p className="mt-2 text-xs text-[#888]">
          {formatDutchDate(post.scheduledDate)}
        </p>
      </div>
    </button>
  )
}
```

- [ ] **Step 2: Create the pending posts section with slide-over state**

Create `src/components/dashboard/pending-posts.tsx`:

```typescript
"use client"

import { useState } from "react"
import type { Post } from "@/lib/posts/types"
import { PostCard } from "./post-card"
import { PostSlideOver } from "./post-slide-over"

interface PendingPostsProps {
  posts: Post[]
}

export function PendingPosts({ posts: initialPosts }: PendingPostsProps) {
  const [posts, setPosts] = useState<Post[]>(initialPosts)
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const selectedPost = posts.find((p) => p.id === selectedPostId) ?? null

  function showToast(message: string) {
    setToast(message)
    setTimeout(() => setToast(null), 4000)
  }

  function handlePostApproved(postId: string) {
    setPosts((prev) => prev.filter((p) => p.id !== postId))
    setSelectedPostId(null)
    showToast("Post goedgekeurd!")
  }

  function handlePostRejected(postId: string) {
    setPosts((prev) => prev.filter((p) => p.id !== postId))
    setSelectedPostId(null)
  }

  function handlePostRegenerated(updatedPost: Post) {
    setPosts((prev) =>
      prev.map((p) => (p.id === updatedPost.id ? updatedPost : p))
    )
  }

  function handleApproveError() {
    showToast("Kon niet goedkeuren, probeer opnieuw.")
  }

  if (posts.length === 0) {
    return (
      <section>
        <h2 className="text-base font-semibold text-[#1a1a1a] mb-3">
          Wacht op goedkeuring
        </h2>
        <p className="text-sm text-[#888]">
          Geen posts om te beoordelen. Alles is up-to-date!
        </p>
      </section>
    )
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-base font-semibold text-[#1a1a1a]">
          Wacht op goedkeuring
        </h2>
        <span className="bg-[#ef4444] text-white text-xs font-semibold px-2 py-0.5 rounded-full">
          {posts.length}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onClick={() => setSelectedPostId(post.id)}
          />
        ))}
      </div>

      {selectedPost && (
        <PostSlideOver
          post={selectedPost}
          onClose={() => setSelectedPostId(null)}
          onApproved={handlePostApproved}
          onRejected={handlePostRejected}
          onRegenerated={handlePostRegenerated}
          onApproveError={handleApproveError}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#1a1a1a] text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/pending-posts.tsx src/components/dashboard/post-card.tsx
git commit -m "feat: add pending posts section and post card components"
```

---

### Task 6: Upcoming Posts + Published Posts Sections

**Files:**
- Create: `src/components/dashboard/upcoming-posts.tsx`
- Create: `src/components/dashboard/published-posts.tsx`

- [ ] **Step 1: Create the upcoming posts component**

Create `src/components/dashboard/upcoming-posts.tsx`:

```typescript
import type { Post } from "@/lib/posts/types"

interface UpcomingPostsProps {
  posts: Post[]
}

function formatDutchDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00")
  const days = ["zo", "ma", "di", "wo", "do", "vr", "za"]
  const months = [
    "jan", "feb", "mrt", "apr", "mei", "jun",
    "jul", "aug", "sep", "okt", "nov", "dec",
  ]
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`
}

export function UpcomingPosts({ posts }: UpcomingPostsProps) {
  if (posts.length === 0) {
    return (
      <section>
        <h2 className="text-base font-semibold text-[#1a1a1a] mb-3">
          Binnenkort gepland
        </h2>
        <p className="text-sm text-[#888]">
          Nog geen goedgekeurde posts deze week.
        </p>
      </section>
    )
  }

  // Group posts by scheduledDate
  const grouped = new Map<string, Post[]>()
  for (const post of posts) {
    const existing = grouped.get(post.scheduledDate) ?? []
    existing.push(post)
    grouped.set(post.scheduledDate, existing)
  }

  const days = Array.from(grouped.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  )

  return (
    <section>
      <h2 className="text-base font-semibold text-[#1a1a1a] mb-3">
        Binnenkort gepland
      </h2>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {days.map(([date, dayPosts]) => (
          <div
            key={date}
            className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg px-3.5 py-2.5 min-w-[120px] flex-shrink-0"
          >
            <p className="text-sm font-semibold text-[#15803d]">
              {formatDutchDate(date)}
            </p>
            <p className="text-xs text-[#666] mt-0.5">
              {dayPosts.length} {dayPosts.length === 1 ? "post" : "posts"}
            </p>
            <div className="flex gap-1 mt-1.5">
              {dayPosts.map((p) => (
                <span
                  key={p.id}
                  className="text-xs bg-white px-1.5 py-0.5 rounded text-[#888]"
                >
                  {p.platform === "instagram" ? "IG" : "FB"}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Create the published posts component**

Create `src/components/dashboard/published-posts.tsx`:

```typescript
import type { Post } from "@/lib/posts/types"

interface PublishedPostsProps {
  posts: Post[]
}

function formatDutchDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00")
  const days = ["zo", "ma", "di", "wo", "do", "vr", "za"]
  const months = [
    "jan", "feb", "mrt", "apr", "mei", "jun",
    "jul", "aug", "sep", "okt", "nov", "dec",
  ]
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`
}

function platformLabel(platform: string): string {
  return platform === "instagram" ? "Instagram" : "Facebook"
}

export function PublishedPosts({ posts }: PublishedPostsProps) {
  if (posts.length === 0) {
    return (
      <section>
        <h2 className="text-base font-semibold text-[#1a1a1a] mb-3">
          Recent geplaatst
        </h2>
        <p className="text-sm text-[#888]">Nog geen posts geplaatst.</p>
      </section>
    )
  }

  // Show last 5, sorted by publishedAt descending
  const sorted = [...posts]
    .sort((a, b) => {
      const aTime = a.publishedAt?.getTime() ?? 0
      const bTime = b.publishedAt?.getTime() ?? 0
      return bTime - aTime
    })
    .slice(0, 5)

  return (
    <section>
      <h2 className="text-base font-semibold text-[#1a1a1a] mb-3">
        Recent geplaatst
      </h2>
      <div className="flex flex-col gap-1.5">
        {sorted.map((post) => (
          <div
            key={post.id}
            className="bg-white border border-[#e5e5e5] rounded-lg px-3.5 py-3 flex items-center justify-between"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-[#333] truncate">{post.content}</p>
              <p className="text-xs text-[#888] mt-0.5">
                {formatDutchDate(post.scheduledDate)} &middot;{" "}
                {platformLabel(post.platform)}
              </p>
            </div>
            {/* Metrics stubbed — Meta API not wired yet */}
            <div className="text-xs text-[#ccc] ml-4 whitespace-nowrap">
              &mdash; likes
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/upcoming-posts.tsx src/components/dashboard/published-posts.tsx
git commit -m "feat: add upcoming and published posts sections"
```

---

### Task 7: Slide-Over Panel Shell

**Files:**
- Create: `src/components/dashboard/post-slide-over.tsx`

- [ ] **Step 1: Create the slide-over panel**

Create `src/components/dashboard/post-slide-over.tsx`:

```typescript
"use client"

import { useEffect } from "react"
import type { Post } from "@/lib/posts/types"
import { PostPreview } from "./post-preview"
import { PostActions } from "./post-actions"

interface PostSlideOverProps {
  post: Post
  onClose: () => void
  onApproved: (postId: string) => void
  onRejected: (postId: string) => void
  onRegenerated: (updatedPost: Post) => void
  onApproveError: () => void
}

export function PostSlideOver({
  post,
  onClose,
  onApproved,
  onRejected,
  onRegenerated,
  onApproveError,
}: PostSlideOverProps) {
  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  // Prevent body scroll when panel is open
  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = ""
    }
  }, [])

  return (
    <div className="fixed inset-0 z-40">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="absolute right-0 top-0 bottom-0 w-full sm:w-[60%] sm:max-w-2xl bg-white shadow-[-8px_0_30px_rgba(0,0,0,0.1)] flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f0f0]">
          <h3 className="text-base font-semibold text-[#1a1a1a]">
            Post beoordelen
          </h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md border border-[#e5e5e5] flex items-center justify-center text-[#888] hover:bg-[#f5f5f5] transition-colors"
          >
            &times;
          </button>
        </div>

        {/* Content: two columns on desktop, stacked on mobile */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="flex flex-col sm:flex-row gap-6">
            <div className="sm:w-1/2">
              <PostPreview post={post} />
            </div>
            <div className="sm:w-1/2">
              <PostActions
                post={post}
                onApproved={onApproved}
                onRejected={onRejected}
                onRegenerated={onRegenerated}
                onApproveError={onApproveError}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the slide-in animation to globals.css**

Add to `src/app/globals.css`:

```css
@keyframes slide-in {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

.animate-slide-in {
  animation: slide-in 0.2s ease-out;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/post-slide-over.tsx src/app/globals.css
git commit -m "feat: add slide-over panel shell with animation"
```

---

### Task 8: Post Preview Component (IG/FB)

**Files:**
- Create: `src/components/dashboard/post-preview.tsx`

- [ ] **Step 1: Create the platform preview component**

Create `src/components/dashboard/post-preview.tsx`:

```typescript
import type { Post } from "@/lib/posts/types"

interface PostPreviewProps {
  post: Post
}

function InstagramPreview({ post }: { post: Post }) {
  return (
    <div className="border border-[#e5e5e5] rounded-lg overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="w-7 h-7 rounded-full bg-[#e8dcc8] flex items-center justify-center text-xs">
          ☕
        </div>
        <span className="text-xs font-semibold text-[#1a1a1a]">
          cafedehoek
        </span>
      </div>
      {/* Photo area */}
      <div className="bg-gradient-to-br from-[#f5f0e8] to-[#e8dcc8] h-48 flex items-center justify-center">
        {post.photoId ? (
          <span className="text-5xl">📷</span>
        ) : (
          <span className="text-5xl">📝</span>
        )}
      </div>
      {/* Caption */}
      <div className="px-3 py-2">
        <p className="text-xs leading-relaxed text-[#333]">
          <span className="font-semibold">cafedehoek</span>{" "}
          {post.content}
        </p>
      </div>
    </div>
  )
}

function FacebookPreview({ post }: { post: Post }) {
  return (
    <div className="border border-[#e5e5e5] rounded-lg overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="w-7 h-7 rounded-full bg-[#e8dcc8] flex items-center justify-center text-xs">
          ☕
        </div>
        <div>
          <span className="text-xs font-semibold text-[#1a1a1a]">
            Café de Hoek
          </span>
          <p className="text-[10px] text-[#888]">Arnhem</p>
        </div>
      </div>
      {/* Text content */}
      <div className="px-3 pb-2">
        <p className="text-xs leading-relaxed text-[#333]">{post.content}</p>
      </div>
      {/* Photo area */}
      {post.photoId && (
        <div className="bg-gradient-to-br from-[#f5f0e8] to-[#e8dcc8] h-40 flex items-center justify-center">
          <span className="text-5xl">📷</span>
        </div>
      )}
    </div>
  )
}

export function PostPreview({ post }: PostPreviewProps) {
  if (post.platform === "instagram") {
    return <InstagramPreview post={post} />
  }
  return <FacebookPreview post={post} />
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/post-preview.tsx
git commit -m "feat: add IG/FB post preview component"
```

---

### Task 9: Post Actions Component (Approve, Reject, Regenerate)

**Files:**
- Create: `src/components/dashboard/post-actions.tsx`

This is the most complex client component — handles caption editing, all three action buttons, the inline feedback expansion, regeneration loading state, and optimistic approve.

- [ ] **Step 1: Create the post actions component**

Create `src/components/dashboard/post-actions.tsx`:

```typescript
"use client"

import { useState, useTransition } from "react"
import type { Post } from "@/lib/posts/types"
import {
  approvePostAction,
  rejectPostAction,
  regeneratePostAction,
} from "@/lib/posts/actions"
import { MAX_REJECTIONS } from "@/lib/posts/config"

interface PostActionsProps {
  post: Post
  onApproved: (postId: string) => void
  onRejected: (postId: string) => void
  onRegenerated: (updatedPost: Post) => void
  onApproveError: () => void
}

function formatDutchDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00")
  const days = ["zo", "ma", "di", "wo", "do", "vr", "za"]
  const months = [
    "jan", "feb", "mrt", "apr", "mei", "jun",
    "jul", "aug", "sep", "okt", "nov", "dec",
  ]
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`
}

type Mode = "actions" | "feedback" | "regenerating"

export function PostActions({
  post,
  onApproved,
  onRejected,
  onRegenerated,
  onApproveError,
}: PostActionsProps) {
  const [caption, setCaption] = useState(post.content)
  const [mode, setMode] = useState<Mode>("actions")
  const [feedback, setFeedback] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const isEdited = caption !== post.content
  const isInstagram = post.platform === "instagram"
  const atMaxRejections = post.rejectionCount >= MAX_REJECTIONS

  function handleApprove() {
    startTransition(async () => {
      const result = await approvePostAction(
        post.id,
        isEdited ? caption : undefined
      )
      if (result.success) {
        onApproved(post.id)
      } else {
        onApproveError()
      }
    })
  }

  function handleReject() {
    startTransition(async () => {
      const result = await rejectPostAction(post.id)
      if (result.success) {
        onRejected(post.id)
      } else {
        setError(result.error ?? "Er ging iets mis")
      }
    })
  }

  function handleRegenerate() {
    if (feedback.trim().length < 10) {
      setError("Feedback moet minimaal 10 tekens bevatten")
      return
    }
    setError(null)
    setMode("regenerating")

    startTransition(async () => {
      const result = await regeneratePostAction(post.id, feedback.trim())
      if (result.success && result.post) {
        setCaption(result.post.content)
        setFeedback("")
        setMode("actions")
        onRegenerated(result.post)
      } else {
        setError(result.error ?? "Regeneratie mislukt")
        setMode("feedback")
      }
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Platform & date */}
      <div className="flex gap-4 mb-5">
        <div>
          <p className="text-[10px] text-[#888] uppercase tracking-wider">
            Platform
          </p>
          <p className="text-sm font-medium text-[#1a1a1a] mt-0.5 flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{
                background: isInstagram
                  ? "linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)"
                  : "#1877f2",
              }}
            />
            {isInstagram ? "Instagram" : "Facebook"}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[#888] uppercase tracking-wider">
            Gepland op
          </p>
          <p className="text-sm font-medium text-[#1a1a1a] mt-0.5">
            {formatDutchDate(post.scheduledDate)}
          </p>
        </div>
      </div>

      {/* Editable caption */}
      <div className="mb-5 flex-1">
        <p className="text-[10px] text-[#888] uppercase tracking-wider mb-1.5">
          Tekst
          {isEdited && (
            <span className="text-[#2563eb] normal-case tracking-normal ml-1">
              &middot; bewerkt
            </span>
          )}
        </p>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          className={`w-full rounded-lg p-3 text-sm text-[#333] leading-relaxed min-h-[100px] resize-none transition-colors ${
            isEdited
              ? "border-2 border-[#2563eb] bg-[#f8faff]"
              : "border border-[#d4d4d4] bg-[#fafafa]"
          }`}
        />
        {!isEdited && (
          <p className="text-xs text-[#aaa] mt-1">
            Klik om de tekst aan te passen
          </p>
        )}
      </div>

      {/* Error message */}
      {error && (
        <p className="text-sm text-[#ef4444] mb-3">{error}</p>
      )}

      {/* Action buttons or feedback form */}
      {mode === "actions" && (
        <div className="flex flex-col gap-2">
          <button
            onClick={handleApprove}
            disabled={isPending}
            className="bg-[#1a1a1a] text-white text-sm font-medium py-2.5 px-4 rounded-lg hover:bg-[#333] transition-colors disabled:opacity-50"
          >
            {isPending
              ? "Even geduld..."
              : isEdited
                ? "Goedkeuren met aanpassingen"
                : "Goedkeuren"}
          </button>
          <button
            onClick={() => {
              if (atMaxRejections) {
                setError(
                  "Je hebt het maximum aantal wijzigingen bereikt. Neem contact op met Stefan."
                )
              } else {
                setMode("feedback")
                setError(null)
              }
            }}
            disabled={isPending}
            className="border border-[#d4d4d4] text-[#333] text-sm py-2.5 px-4 rounded-lg hover:bg-[#f5f5f5] transition-colors disabled:opacity-50"
          >
            Wijzigingen aanvragen
          </button>
          <button
            onClick={handleReject}
            disabled={isPending}
            className="text-[#888] text-sm py-2 hover:text-[#666] transition-colors disabled:opacity-50"
          >
            Overslaan
          </button>
        </div>
      )}

      {mode === "feedback" && (
        <div>
          <p className="text-[10px] text-[#888] uppercase tracking-wider mb-1.5">
            Wat wil je anders?
          </p>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder='Bijv. "Minder emoji\'s" of "Meer over de appeltaart"'
            className="w-full border border-[#d4d4d4] rounded-lg p-3 text-sm text-[#333] leading-relaxed min-h-[80px] resize-none bg-[#fafafa]"
          />
          <p className="text-xs text-[#aaa] mt-1">Minimaal 10 tekens</p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleRegenerate}
              disabled={feedback.trim().length < 10}
              className="flex-1 bg-[#1a1a1a] text-white text-sm font-medium py-2.5 rounded-lg hover:bg-[#333] transition-colors disabled:opacity-50"
            >
              Opnieuw genereren
            </button>
            <button
              onClick={() => {
                setMode("actions")
                setFeedback("")
                setError(null)
              }}
              className="border border-[#d4d4d4] text-[#888] text-sm py-2.5 px-4 rounded-lg hover:bg-[#f5f5f5] transition-colors"
            >
              Annuleren
            </button>
          </div>
        </div>
      )}

      {mode === "regenerating" && (
        <div className="text-center py-6">
          <p className="text-sm font-medium text-[#333]">Even geduld...</p>
          <p className="text-xs text-[#888] mt-1">
            We maken een nieuwe versie van je post.
          </p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty false 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/post-actions.tsx
git commit -m "feat: add post actions component with approve, reject, regenerate"
```

---

### Task 10: Visual Smoke Test — Run Dev Server

**Files:** None created — verification only

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify the dashboard loads**

Open `http://localhost:3000/dashboard` in a browser. Verify:
- Header shows "Postje" + business name + "Log uit"
- Three sections render (may be empty states if no seed data)
- No console errors

- [ ] **Step 3: Seed test data if needed**

Run: `npx tsx scripts/seed-cafe-de-hoek.ts`

Then generate posts for the test client:
```bash
curl -X POST http://localhost:3000/api/generate-posts \
  -H "Content-Type: application/json" \
  -d '{"clientId":"cafe-de-hoek-00000000","startDate":"2026-05-12"}'
```

- [ ] **Step 4: Verify pending posts appear**

Refresh `/dashboard`. Verify:
- Pending cards appear with caption previews, platform badges, dates
- Clicking a card opens the slide-over panel
- Slide-over shows platform preview on the left, actions on the right
- Caption textarea is editable
- Approve button works (card disappears, toast shows)
- "Wijzigingen aanvragen" expands the feedback textarea inline
- "Overslaan" removes the card

- [ ] **Step 5: Commit any fixes discovered during smoke test**

```bash
git add -A
git commit -m "fix: address issues found during smoke test"
```

---

### Task 11: E2E Verification Script

**Files:**
- Create: `scripts/e2e-approval-flow.ts`
- Modify: `package.json` (add script entry)

- [ ] **Step 1: Create the E2E verification script**

Create `scripts/e2e-approval-flow.ts`:

```typescript
/**
 * E2E Approval Flow Verification Script
 *
 * Runtime: ~10 seconds (excluding Claude API calls for regeneration)
 * When to run: After changes to the dashboard, approval UI, or post
 * repository. Also run before merging the client-dashboard-approval branch.
 *
 * What it tests:
 * 1. Dashboard data loading (posts grouped by status)
 * 2. Approve a post (with and without edits)
 * 3. Reject (skip) a post
 * 4. Regeneration in place (content update, count increment)
 * 5. MAX_REJECTIONS enforcement
 * 6. Locked-day rejection path
 * 7. Client isolation (clientId filtering)
 *
 * Prerequisites:
 * - Run `npm run db:migrate` first
 * - Does NOT require a running dev server (tests the repository layer directly)
 * - Does NOT call the Claude API (regeneration is tested at the repo level)
 */

import { createTestDb, seedTestClient, seedTestPhoto } from "../src/test/db"
import {
  insertPosts,
  getPostsByDateRange,
  getPostById,
  approvePost,
  rejectPost,
  regeneratePost,
} from "../src/lib/posts/repository"
import { MAX_REJECTIONS } from "../src/lib/posts/config"

const db = createTestDb()

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`)
    passed++
  } else {
    console.error(`  ✗ ${message}`)
    failed++
  }
}

// ── Setup ──
console.log("\n=== E2E Approval Flow Verification ===\n")

const clientId = seedTestClient(db)
const otherClientId = seedTestClient(db, "other-client")
const photoId = seedTestPhoto(db, clientId, "photo-001")

// Seed posts for the week
insertPosts(db, [
  { clientId, platform: "instagram", scheduledDate: "2026-05-12", content: "IG Monday", reasoning: "test", photoId },
  { clientId, platform: "facebook", scheduledDate: "2026-05-12", content: "FB Monday", reasoning: "test" },
  { clientId, platform: "instagram", scheduledDate: "2026-05-13", content: "IG Tuesday", reasoning: "test" },
  { clientId, platform: "facebook", scheduledDate: "2026-05-13", content: "FB Tuesday", reasoning: "test" },
  { clientId, platform: "instagram", scheduledDate: "2026-05-14", content: "IG Wednesday", reasoning: "test" },
])

// ── Test 1: Dashboard data loading ──
console.log("Test 1: Dashboard data loading")
const allPosts = getPostsByDateRange(db, clientId, "2026-05-12", "2026-05-18")
assert(allPosts.length === 5, "Should have 5 posts for the week")
assert(allPosts.every(p => p.status === "draft"), "All posts should be drafts")

// ── Test 2: Approve a post ──
console.log("\nTest 2: Approve a post")
const postToApprove = allPosts[0]
const approved = approvePost(db, postToApprove.id, clientId)
assert(approved.status === "approved", "Post status should be approved")
assert(approved.approvedAt !== null, "approvedAt should be set")
assert(approved.content === "IG Monday", "Content should be unchanged")

// ── Test 3: Approve with edits ──
console.log("\nTest 3: Approve with edits")
const postToEdit = allPosts[1]
const edited = approvePost(db, postToEdit.id, clientId, "Edited FB content")
assert(edited.status === "approved", "Post status should be approved")
assert(edited.content === "Edited FB content", "Content should be updated")

// ── Test 4: Reject (skip) a post ──
console.log("\nTest 4: Reject (skip) a post")
const postToReject = allPosts[2]
const rejected = rejectPost(db, postToReject.id, clientId)
assert(rejected.status === "rejected", "Post status should be rejected")
assert(rejected.rejectedAt !== null, "rejectedAt should be set")
assert(rejected.rejectionCount === 1, "rejectionCount should be 1")

// ── Test 5: Regenerate in place ──
console.log("\nTest 5: Regenerate in place")
const postToRegen = allPosts[3]
const regenerated = regeneratePost(db, postToRegen.id, clientId, "New FB Tuesday", "regenerated reasoning")
assert(regenerated.id === postToRegen.id, "Should keep the same post ID")
assert(regenerated.content === "New FB Tuesday", "Content should be updated")
assert(regenerated.reasoning === "regenerated reasoning", "Reasoning should be updated")
assert(regenerated.rejectionCount === 1, "rejectionCount should be 1")
assert(regenerated.status === "draft", "Status should still be draft")

// ── Test 6: MAX_REJECTIONS enforcement ──
console.log("\nTest 6: MAX_REJECTIONS enforcement")
const postForMaxTest = allPosts[4]
// Regenerate up to MAX_REJECTIONS
for (let i = 0; i < MAX_REJECTIONS; i++) {
  regeneratePost(db, postForMaxTest.id, clientId, `Version ${i + 2}`, "regen")
}
const maxedPost = getPostById(db, postForMaxTest.id, clientId)!
assert(maxedPost.rejectionCount === MAX_REJECTIONS, `rejectionCount should be ${MAX_REJECTIONS}`)

// ── Test 7: Client isolation ──
console.log("\nTest 7: Client isolation")
const crossClientPost = getPostById(db, postToApprove.id, otherClientId)
assert(crossClientPost === null, "Should not find post with wrong clientId")

let crossClientError = false
try {
  approvePost(db, allPosts[3].id, otherClientId)
} catch {
  crossClientError = true
}
assert(crossClientError, "Should throw when approving with wrong clientId")

// ── Test 8: Cannot approve non-draft ──
console.log("\nTest 8: Cannot approve non-draft")
let doubleApproveError = false
try {
  approvePost(db, postToApprove.id, clientId) // already approved
} catch {
  doubleApproveError = true
}
assert(doubleApproveError, "Should throw when approving an already-approved post")

// ── Summary ──
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
process.exit(failed > 0 ? 1 : 0)
```

- [ ] **Step 2: Register the script in package.json**

Add to the `"scripts"` section in `package.json`:

```json
"test:approval": "tsx scripts/e2e-approval-flow.ts"
```

- [ ] **Step 3: Run the E2E script**

Run: `npm run test:approval`
Expected: All assertions pass, exit code 0

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e-approval-flow.ts package.json
git commit -m "test: add E2E approval flow verification script"
```

---

### Task 12: Final Build Verification

**Files:** None — verification only

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: All existing tests + new repository tests pass

- [ ] **Step 2: Run the E2E approval script**

Run: `npm run test:approval`
Expected: All assertions pass

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Check for TypeScript errors**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Verify no console.log in new code**

Run: `grep -rn "console.log" src/components/dashboard/ src/lib/posts/actions.ts src/lib/ai/regenerate-post.ts`
Expected: No matches (console.warn in existing code is intentional)
