import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { eq } from "drizzle-orm"
import { clients } from "@/db/schema"
import { getPostsByDateRange } from "@/lib/posts/repository"
import type { Post } from "@/lib/posts/types"
import PendingPosts from "@/components/dashboard/pending-posts"
import UpcomingPosts from "@/components/dashboard/upcoming-posts"
import PublishedPosts from "@/components/dashboard/published-posts"

function getCurrentWeekStart(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff)
  return monday.toISOString().split("T")[0]
}

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

  const weekStart = getCurrentWeekStart()
  const weekStartDate = new Date(weekStart)
  const weekEndDate = new Date(weekStartDate)
  weekEndDate.setDate(weekStartDate.getDate() + 6)
  const weekEndStr = weekEndDate.toISOString().split("T")[0]

  const posts = getPostsByDateRange(db, client.id, weekStart, weekEndStr)

  const pendingPosts: Post[] = posts.filter((p) => p.status === "draft")
  const approvedPosts: Post[] = posts.filter((p) => p.status === "approved")
  const publishedPosts: Post[] = posts.filter((p) => p.status === "published")

  return (
    <div className="space-y-10">
      <PendingPosts posts={pendingPosts} />
      <UpcomingPosts posts={approvedPosts} />
      <PublishedPosts posts={publishedPosts} />
    </div>
  )
}
