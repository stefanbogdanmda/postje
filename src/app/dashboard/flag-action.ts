"use server"

import { auth } from "@/lib/auth"
import { db } from "@/db"
import { postFlags, clients } from "@/db/schema"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export async function flagPostAction(
  postId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const session = await auth()
  if (!session) {
    return { success: false, error: "Not authenticated" }
  }

  const clientRows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.userId, session.user.id))
    .limit(1)
  const client = clientRows[0]

  if (!client) {
    return { success: false, error: "No client profile found" }
  }

  await db.insert(postFlags).values({
    postId,
    clientId: client.id,
    reason: reason ?? null,
  })

  revalidatePath("/dashboard")
  return { success: true }
}
