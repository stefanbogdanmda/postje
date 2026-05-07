import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { photos } from "@/db/schema"
import { eq } from "drizzle-orm"
import { analyzePhoto } from "@/lib/photos/analyze"

export const maxDuration = 60

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const photo = await db
      .select()
      .from(photos)
      .where(eq(photos.id, id))
      .get()

    if (!photo) {
      return NextResponse.json(
        { error: "Photo not found" },
        { status: 404 }
      )
    }

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
    const message =
      error instanceof Error ? error.message : "Analysis failed"
    return NextResponse.json(
      { analysisStatus: "failed" as const, error: message },
      { status: 500 }
    )
  }
}
