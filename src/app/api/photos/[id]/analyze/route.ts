import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { photos } from "@/db/schema"
import { eq } from "drizzle-orm"
import { analyzePhoto } from "@/lib/photos/analyze"
import { requireClientAccess, toErrorResponse } from "@/lib/authorization"
import { rateLimitRequest } from "@/lib/request-rate-limit"

export const maxDuration = 60

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await rateLimitRequest(request, "photo-analyze", 20, 15 * 60 * 1000)
    if (rateLimited) return rateLimited

    const { id } = await params

    const photoRows = await db
      .select()
      .from(photos)
      .where(eq(photos.id, id))
      .limit(1)
    const photo = photoRows[0]

    if (!photo) {
      return NextResponse.json(
        { error: "Photo not found" },
        { status: 404 }
      )
    }

    await requireClientAccess(photo.clientId)

    const analysis = await analyzePhoto(photo.blobUrl)
    const now = new Date()

    await db
      .update(photos)
      .set({ analysis, analyzedAt: now })
      .where(eq(photos.id, id))

    return NextResponse.json({
      analysisStatus: "succeeded" as const,
      analysis,
      analyzedAt: now.toISOString(),
    })
  } catch (error: unknown) {
    return toErrorResponse(error)
  }
}
