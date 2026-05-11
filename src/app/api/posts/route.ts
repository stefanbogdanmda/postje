import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { getPostsByDateRange } from "@/lib/posts/repository"
import type { PostsByDay } from "@/lib/posts/types"
import { requireClientAccess, toErrorResponse } from "@/lib/authorization"

/** Maximum date range in days to prevent unbounded queries. */
const MAX_RANGE_DAYS = 31
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const requestedClientId = searchParams.get("clientId")
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")

    if (
      !startDate ||
      !endDate ||
      !ISO_DATE_RE.test(startDate) ||
      !ISO_DATE_RE.test(endDate)
    ) {
      return NextResponse.json(
        { error: "startDate and endDate must use YYYY-MM-DD format" },
        { status: 400 }
      )
    }

    const { clientId } = await requireClientAccess(requestedClientId)

    // Validate date range
    const start = new Date(startDate + "T00:00:00Z")
    const end = new Date(endDate + "T00:00:00Z")
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)

    if (!Number.isFinite(diffDays)) {
      return NextResponse.json(
        { error: "Dates must use YYYY-MM-DD format" },
        { status: 400 }
      )
    }

    if (diffDays < 0) {
      return NextResponse.json(
        { error: "endDate must be after startDate" },
        { status: 400 }
      )
    }

    if (diffDays > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { error: `Date range cannot exceed ${MAX_RANGE_DAYS} days` },
        { status: 400 }
      )
    }

    const posts = getPostsByDateRange(db, clientId, startDate, endDate)

    // Group by scheduledDate
    const grouped = new Map<string, typeof posts>()
    for (const post of posts) {
      const existing = grouped.get(post.scheduledDate) ?? []
      existing.push(post)
      grouped.set(post.scheduledDate, existing)
    }

    const result: PostsByDay[] = Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([scheduledDate, dayPosts]) => ({
        scheduledDate,
        posts: dayPosts,
      }))

    return NextResponse.json(result)
  } catch (error: unknown) {
    return toErrorResponse(error)
  }
}
