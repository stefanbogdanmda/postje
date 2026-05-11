import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { eq } from "drizzle-orm"
import { clients } from "@/db/schema"
import {
  getPostsByDateRange,
  markPostsAsSeen,
} from "@/lib/posts/repository"
import { getGenerationWeekRange } from "@/lib/posts/dates"
import type { Post } from "@/lib/posts/types"
import PendingPosts from "@/components/dashboard/pending-posts"
import UpcomingPosts from "@/components/dashboard/upcoming-posts"
import PublishedPosts from "@/components/dashboard/published-posts"

export default async function DashboardPage() {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  const client = db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.userId, session.user.id))
    .get()

  if (!client) {
    redirect("/login")
  }

  const { startDate: weekStart, endDate: weekEndStr } =
    getGenerationWeekRange()

  const posts = getPostsByDateRange(db, client.id, weekStart, weekEndStr)

  const pendingPosts: Post[] = posts.filter((p) => p.status === "draft")
  const approvedPosts: Post[] = posts.filter((p) => p.status === "approved")
  const publishedPosts: Post[] = posts.filter((p) => p.status === "published")

  // Stamp firstSeenAt on pending posts that the client is seeing for the
  // first time. The repository function is a no-op for posts whose
  // firstSeenAt is already set, so running it on every load is safe.
  const unseenPendingIds = pendingPosts
    .filter((p) => p.firstSeenAt === null)
    .map((p) => p.id)

  if (unseenPendingIds.length > 0) {
    markPostsAsSeen(db, unseenPendingIds, client.id)
  }

  return (
    <div className="space-y-10">
      <PendingPosts posts={pendingPosts} />
      <UpcomingPosts posts={approvedPosts} />
      <PublishedPosts posts={publishedPosts} />
    </div>
  )
}
