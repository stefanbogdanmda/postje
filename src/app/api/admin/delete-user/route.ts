import { auth } from "@/lib/auth"
import { db } from "@/db"
import {
  users,
  sessions,
  accounts,
  verificationTokens,
  deletionAuditLog,
} from "@/db/schema"
import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  // Verify the caller is an admin
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

  // Look up the user to get their email for the audit log
  const userToDelete = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .get()

  if (!userToDelete) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  // Prevent deleting admin accounts through this endpoint
  if (userToDelete.role === "admin") {
    return NextResponse.json(
      { error: "Cannot delete admin accounts" },
      { status: 403 }
    )
  }

  // Write the audit log entry BEFORE deleting (so we have the data)
  await db.insert(deletionAuditLog).values({
    deletedUserEmail: userToDelete.email,
    deletedUserId: userToDelete.id,
    deletedBy: session.user.id,
  })

  // Hard delete from all auth tables
  // Order matters: delete dependent rows first to avoid foreign key issues
  await db
    .delete(verificationTokens)
    .where(eq(verificationTokens.identifier, userToDelete.email))
  await db.delete(sessions).where(eq(sessions.userId, userId))
  await db.delete(accounts).where(eq(accounts.userId, userId))
  await db.delete(users).where(eq(users.id, userId))

  return NextResponse.json({ success: true })
}
