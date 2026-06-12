import { describe, it, expect, beforeEach, vi } from "vitest"
import { createTestDb, seedTestClient, type TestDb } from "@/test/db"
import { posts } from "@/db/schema"
import { eq } from "drizzle-orm"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

let testDb: TestDb
vi.mock("@/db", () => ({
  get db() {
    return testDb
  },
}))

import { cancelApprovedPostAction } from "../cancel-action"
import { auth } from "@/lib/auth"

const mockedAuth = vi.mocked(auth)

const CLIENT_A = "client-a"
const CLIENT_B = "client-b"

async function seedPost(
  clientId: string,
  status: "approved" | "draft" = "approved"
): Promise<string> {
  await testDb.insert(posts).values({
    clientId,
    platform: "facebook",
    scheduledDate: "2026-05-12",
    status,
    content: "a post",
    reasoning: "r",
    approvedAt: status === "approved" ? new Date() : null,
    publishAt: status === "approved" ? new Date() : null,
  })
  const rows = await testDb
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.clientId, clientId))
  return rows[0].id
}

async function statusOf(postId: string): Promise<string> {
  const rows = await testDb
    .select({ status: posts.status })
    .from(posts)
    .where(eq(posts.id, postId))
  return rows[0].status
}

beforeEach(async () => {
  testDb = await createTestDb()
  await seedTestClient(testDb, CLIENT_A)
  await seedTestClient(testDb, CLIENT_B)
  vi.clearAllMocks()
  mockedAuth.mockResolvedValue({
    user: { id: `user-${CLIENT_A}`, role: "client" },
  } as never)
})

describe("cancelApprovedPostAction", () => {
  it("rejects an unauthenticated caller", async () => {
    mockedAuth.mockResolvedValue(null as never)
    const result = await cancelApprovedPostAction("any-id")
    expect(result).toEqual({ success: false, error: "Not authenticated" })
  })

  it("moves the caller's own approved post back to draft", async () => {
    const postId = await seedPost(CLIENT_A, "approved")

    const result = await cancelApprovedPostAction(postId)

    expect(result.success).toBe(true)
    expect(await statusOf(postId)).toBe("draft")
  })

  it("will not cancel another client's approved post (tenant isolation)", async () => {
    const otherPostId = await seedPost(CLIENT_B, "approved")

    const result = await cancelApprovedPostAction(otherPostId)

    // The action reports success (no row matched the WHERE) but must not have
    // touched the other client's post.
    expect(result.success).toBe(true)
    expect(await statusOf(otherPostId)).toBe("approved")
  })

  it("does not change a post that is not approved", async () => {
    const draftId = await seedPost(CLIENT_A, "draft")

    await cancelApprovedPostAction(draftId)

    expect(await statusOf(draftId)).toBe("draft")
  })
})
