import { auth } from "@/lib/auth"
import { db } from "@/db"
import { users } from "@/db/schema"
import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { del } from "@vercel/blob"
import { deleteUserAccount } from "@/lib/account/delete"

export async function POST(request: Request) {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const body = await request.json()
  const { userId } = body as { userId: string }

  if (!userId) {
    return NextResponse.json(
      { error: "userId is required" },
      { status: 400 }
    )
  }

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
