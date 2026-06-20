import { NextResponse } from "next/server"
import { db } from "@/db"
import { posts } from "@/db/schema"
import { and, eq, lte, isNull } from "drizzle-orm"
import { verifyCronSecret } from "@/lib/cron-auth"
import { publishPostToMeta } from "@/lib/meta/publish"

export const maxDuration = 300

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization")

  const cronAuth = verifyCronSecret(authHeader)
  if (!cronAuth.ok) return cronAuth.response

  const now = new Date()

  // Operator-level job: intentionally NOT scoped to one client — it processes due
  // posts across all clients. publishPostToMeta re-checks clientId ownership per post.
  // Find approved posts whose publishAt has passed and aren't yet published.
  const duePosts = await db
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.status, "approved"),
        lte(posts.publishAt, now),
        isNull(posts.publishedAt)
      )
    )
    .limit(50)

  const results: Array<{
    postId: string
    success: boolean
    metaPostId?: string
    error?: string
  }> = []

  // Published serially (one Meta call at a time). Acceptable at the current client
  // count; switch to bounded-concurrency Promise.allSettled if the daily queue
  // regularly approaches the LIMIT(50) / maxDuration ceiling.
  for (const post of duePosts) {
    const result = await publishPostToMeta(db, post.id, "cron:publish-due")
    results.push({
      postId: post.id,
      success: result.success,
      metaPostId: result.metaPostId,
      error: result.errorMessage ?? result.guardFailure,
    })
  }

  const published = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success).length

  console.log(
    `[cron/publish-due] Processed ${duePosts.length} due posts: ${published} published, ${failed} failed`
  )

  return NextResponse.json({
    processed: duePosts.length,
    published,
    failed,
    results,
  })
}
