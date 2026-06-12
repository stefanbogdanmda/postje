"use server"

import { auth } from "@/lib/auth"
import { db } from "@/db"
import { postFlags, clients, posts } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { sendFlagAlert } from "@/lib/alerts/flag-email"

export async function flagPostAction(
  postId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const session = await auth()
  if (!session) {
    return { success: false, error: "Not authenticated" }
  }

  const clientRows = await db
    .select({ id: clients.id, businessName: clients.businessName })
    .from(clients)
    .where(eq(clients.userId, session.user.id))
    .limit(1)
  const client = clientRows[0]

  if (!client) {
    return { success: false, error: "No client profile found" }
  }

  // Only allow flagging posts that belong to this client. Without this check a
  // logged-in client could flag any post in the system by guessing its ID.
  const postRows = await db
    .select({
      id: posts.id,
      platform: posts.platform,
      scheduledDate: posts.scheduledDate,
      content: posts.content,
    })
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.clientId, client.id)))
    .limit(1)
  const post = postRows[0]

  if (!post) {
    return { success: false, error: "Post not found" }
  }

  await db.insert(postFlags).values({
    postId,
    clientId: client.id,
    reason: reason ?? null,
  })

  // Alert the operator immediately — a flag is the spec's highest-urgency
  // event. Best-effort: never fail the flag because the email could not send.
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
    const result = await sendFlagAlert(
      {
        clientId: client.id,
        businessName: client.businessName,
        platform: post.platform,
        scheduledDate: post.scheduledDate,
        content: post.content,
        reason: reason ?? null,
      },
      appUrl
    )
    if (!result.success) {
      console.error(`[flag-action] flag alert email not sent: ${result.error}`)
    }
  } catch (error) {
    console.error("[flag-action] flag alert email threw", error)
  }

  revalidatePath("/dashboard")
  return { success: true }
}
