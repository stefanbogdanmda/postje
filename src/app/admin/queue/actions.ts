"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { db } from "@/db"
import { publishPostToMeta } from "@/lib/meta/publish"

export interface PublishNowResult {
  ok: true
  metaPostId: string
}

export interface PublishNowErr {
  ok: false
  errorClass: string
  errorMessage: string
}

export type PublishNowActionResult = PublishNowResult | PublishNowErr

/**
 * Admin-only. Triggers publishing of a single approved post. Wraps
 * `publishPostToMeta` so the dependency on `fetch` is implicit (server)
 * and the result is reduced to a JSON-serializable shape for the
 * client component.
 */
export async function publishPostNowAction(
  postId: string
): Promise<PublishNowActionResult> {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    return { ok: false, errorClass: "auth", errorMessage: "Unauthorized" }
  }

  const result = await publishPostToMeta(
    db,
    postId,
    { fetcher: fetch, now: new Date() },
    session.user.id
  )

  revalidatePath("/admin/queue")

  if (result.ok) {
    return { ok: true, metaPostId: result.metaPostId }
  }
  return {
    ok: false,
    errorClass: result.errorClass,
    errorMessage: result.errorMessage,
  }
}
