import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { photos } from "@/db/schema"
import { eq } from "drizzle-orm"
import { validatePhotoFile, uploadPhotoToBlob } from "@/lib/photos/upload"
import { analyzePhoto } from "@/lib/photos/analyze"
import type { PhotoRow, UploadResult } from "@/lib/ai/types"
import { requireClientAccess, toErrorResponse } from "@/lib/authorization"
import { rateLimitRequest } from "@/lib/request-rate-limit"

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const rateLimited = rateLimitRequest(request, "photo-upload", 20, 15 * 60 * 1000)
    if (rateLimited) return rateLimited

    const formData = await request.formData()
    const file = formData.get("file")
    const requestedClientId = formData.get("clientId")

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing file in form data" },
        { status: 400 }
      )
    }

    if (requestedClientId !== null && typeof requestedClientId !== "string") {
      return NextResponse.json(
        { error: "Invalid clientId in form data" },
        { status: 400 }
      )
    }

    const { clientId } = await requireClientAccess(requestedClientId)

    // Validate file
    const validationError = validatePhotoFile(file)
    if (validationError) {
      return NextResponse.json(
        { error: validationError.message },
        { status: 400 }
      )
    }

    // Upload to Vercel Blob
    const { url } = await uploadPhotoToBlob(file, clientId)

    // Create DB row
    const [photoRow] = await db
      .insert(photos)
      .values({
        clientId,
        blobUrl: url,
        originalFilename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      })
      .returning()

    // Attempt analysis (does not roll back upload on failure)
    let analysisStatus: "succeeded" | "failed" = "failed"
    let analysisError: string | undefined

    try {
      const analysis = await analyzePhoto(url)
      const now = new Date()

      await db
        .update(photos)
        .set({ analysis, analyzedAt: now })
        .where(eq(photos.id, photoRow.id))

      photoRow.analysis = analysis
      photoRow.analyzedAt = now
      analysisStatus = "succeeded"
    } catch (err: unknown) {
      analysisError =
        err instanceof Error ? err.message : "Analysis failed"
    }

    const result: UploadResult = {
      photo: photoRow as PhotoRow,
      analysisStatus,
      ...(analysisError && { error: analysisError }),
    }

    return NextResponse.json(result)
  } catch (error: unknown) {
    return toErrorResponse(error)
  }
}
