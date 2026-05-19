"use server"

import { auth } from "@/lib/auth"
import { db } from "@/db"
import { posts, clients } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export async function cancelApprovedPostAction(
  postId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await auth()
  if (!session) {
    return { success: false, error: "Not authenticated" }
  }

  // Get the client for this user
  const clientRows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.userId, session.user.id))
    .limit(1)
  const client = clientRows[0]

  if (!client) {
    return { success: false, error: "No client profile found" }
  }

  // Only cancel approved posts belonging to this client
  await db
    .update(posts)
    .set({
      status: "draft",
      approvedAt: null,
      publishAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(posts.id, postId),
        eq(posts.clientId, client.id),
        eq(posts.status, "approved")
      )
    )

  revalidatePath("/dashboard")
  return { success: true }
}
