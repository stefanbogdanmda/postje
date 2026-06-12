import { describe, it, expect, beforeEach, vi } from "vitest"
import { createTestDb, seedTestClient, type TestDb } from "@/test/db"
import { posts, postFlags } from "@/db/schema"
import { eq } from "drizzle-orm"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/alerts/flag-email", () => ({
  sendFlagAlert: vi.fn().mockResolvedValue({ success: true }),
}))

// Per-test PGlite db, swapped in for the production `db` import.
let testDb: TestDb
vi.mock("@/db", () => ({
  get db() {
    return testDb
  },
}))

import { flagPostAction } from "../flag-action"
import { auth } from "@/lib/auth"
import { sendFlagAlert } from "@/lib/alerts/flag-email"

const mockedAuth = vi.mocked(auth)
const mockedSendFlagAlert = vi.mocked(sendFlagAlert)

const CLIENT_A = "client-a"
const CLIENT_B = "client-b"

async function seedPost(clientId: string): Promise<string> {
  await testDb.insert(posts).values({
    clientId,
    platform: "instagram",
    scheduledDate: "2026-05-12",
    status: "published",
    content: "a post",
    reasoning: "r",
  })
  const rows = await testDb
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.clientId, clientId))
  return rows[0].id
}

beforeEach(async () => {
  testDb = await createTestDb()
  await seedTestClient(testDb, CLIENT_A)
  await seedTestClient(testDb, CLIENT_B)
  vi.clearAllMocks()
  mockedSendFlagAlert.mockResolvedValue({ success: true })
  mockedAuth.mockResolvedValue({
    user: { id: `user-${CLIENT_A}`, role: "client" },
  } as never)
})

describe("flagPostAction", () => {
  it("rejects an unauthenticated caller", async () => {
    mockedAuth.mockResolvedValue(null as never)
    const result = await flagPostAction("any-id")
    expect(result).toEqual({ success: false, error: "Not authenticated" })
  })

  it("flags the caller's own post and alerts the operator", async () => {
    const postId = await seedPost(CLIENT_A)

    const result = await flagPostAction(postId, "wrong info")

    expect(result.success).toBe(true)
    const flags = await testDb
      .select()
      .from(postFlags)
      .where(eq(postFlags.postId, postId))
    expect(flags).toHaveLength(1)
    expect(flags[0].clientId).toBe(CLIENT_A)
    expect(mockedSendFlagAlert).toHaveBeenCalledTimes(1)
  })

  it("will not flag another client's post (tenant isolation)", async () => {
    const otherPostId = await seedPost(CLIENT_B)

    const result = await flagPostAction(otherPostId)

    expect(result).toEqual({ success: false, error: "Post not found" })
    const flags = await testDb.select().from(postFlags)
    expect(flags).toHaveLength(0)
    expect(mockedSendFlagAlert).not.toHaveBeenCalled()
  })

  it("still succeeds when the alert email fails (best-effort)", async () => {
    mockedSendFlagAlert.mockResolvedValue({ success: false, error: "no key" })
    const postId = await seedPost(CLIENT_A)

    const result = await flagPostAction(postId)

    expect(result.success).toBe(true)
    const flags = await testDb.select().from(postFlags)
    expect(flags).toHaveLength(1)
  })
})
