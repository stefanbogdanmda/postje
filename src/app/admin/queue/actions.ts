"use server"

import { auth } from "@/lib/auth"
import { db } from "@/db"
import { revalidatePath } from "next/cache"
import { publishPostToMeta, type PublishResult } from "@/lib/meta/publish"
import { resetFailedPostToApproved } from "@/lib/posts/queue-repository"

interface ActionResult {
  success: boolean
  metaPostId?: string
  errorMessage?: string
  errorReason?: string
}

function toActionResult(r: PublishResult): ActionResult {
  if (r.success) {
    return { success: true, metaPostId: r.metaPostId }
  }
  if (r.guardFailure) {
    return { success: false, errorReason: r.guardFailure }
  }
  return {
    success: false,
    errorReason: r.errorClass ?? "unknown",
    errorMessage: r.errorMessage,
  }
}

/**
 * Operator clicks "Publish now" on an approved post.
 */
export async function publishPostNowAction(
  postId: string
): Promise<ActionResult> {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return { success: false, errorReason: "forbidden" }
  }
  const result = await publishPostToMeta(db, postId, session.user.id)
  revalidatePath("/admin/queue")
  return toActionResult(result)
}

/**
 * Operator clicks "Retry" on a failed post. Flips status back to
 * approved then immediately re-tries the publish.
 */
export async function retryFailedPostAction(
  postId: string
): Promise<ActionResult> {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return { success: false, errorReason: "forbidden" }
  }
  await resetFailedPostToApproved(db, postId)
  const result = await publishPostToMeta(db, postId, session.user.id)
  revalidatePath("/admin/queue")
  return toActionResult(result)
}
