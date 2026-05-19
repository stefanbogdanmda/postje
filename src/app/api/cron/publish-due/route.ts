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

  // Find approved posts where publishAt has passed and not yet published
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
