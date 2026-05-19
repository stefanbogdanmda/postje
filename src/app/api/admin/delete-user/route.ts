import { z } from "zod"
import { auth } from "@/lib/auth"
import { db } from "@/db"
import { users } from "@/db/schema"
import { eq } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"
import { del } from "@vercel/blob"
import { deleteUserAccount } from "@/lib/account/delete"
import { rateLimitRequest } from "@/lib/request-rate-limit"
import { parseBody } from "@/lib/validation"

const deleteUserSchema = z.object({
  userId: z.string().min(1, "userId is required"),
})

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const rateLimited = await rateLimitRequest(request, "admin-delete-user", 5, 60_000)
  if (rateLimited) return rateLimited

  const parsed = await parseBody(request, deleteUserSchema)
  if ("error" in parsed) return parsed.error
  const { userId } = parsed.data

  const userRows = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  const userToDelete = userRows[0]

  if (!userToDelete) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  if (userToDelete.role === "admin") {
    return NextResponse.json(
      { error: "Cannot delete admin accounts" },
      { status: 403 }
    )
  }

  try {
    const result = await deleteUserAccount(
      db,
      userId,
      session.user.id,
      { deleteBlob: async (url) => { await del(url) } }
    )
    return NextResponse.json({ success: true, ...result })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error"
    console.error("[admin/delete-user] Deletion failed", { userId, error: message })
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
