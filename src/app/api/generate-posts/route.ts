import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { photos } from "@/db/schema"
import { eq } from "drizzle-orm"
import { getAnthropicClient } from "@/lib/ai/client"
import {
  buildPlanSystemPrompt,
  buildPlanUserPrompt,
  buildWriteSystemPrompt,
  buildWriteUserPrompt,
} from "@/lib/ai/prompts"
import { extractJSON } from "@/lib/ai/extract-json"
import { validatePosts } from "@/lib/ai/validate-posts"
import { cafeDeHoek } from "@/data/clients/cafe-de-hoek"
import {
  readRejectionCounts,
  replacePostsForOpenDays,
  getLockedDays,
} from "@/lib/posts/repository"
import { buildLockedDaysContext } from "@/lib/posts/locked-days"
import { dayNameToDate, getDateRange } from "@/lib/posts/dates"
import type {
  WeeklyPlan,
  DayPosts,
  AnalyzedPhoto,
  PhotoAnalysis,
} from "@/lib/ai/types"
import type { GeneratePostsRequest, GeneratePostsResponse } from "@/lib/posts/types"
import type { Platform } from "@/lib/posts/config"

const MODEL = "claude-sonnet-4-6"

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request
    const body = (await request.json()) as GeneratePostsRequest
    const { clientId, startDate } = body

    if (!clientId || !startDate) {
      return NextResponse.json(
        { error: "clientId and startDate are required" },
        { status: 400 }
      )
    }

    const dateRange = getDateRange(startDate)
    const endDate = dateRange[dateRange.length - 1]

    // Identify locked and open days
    const lockedDays = getLockedDays(db, clientId, startDate, endDate)
    const lockedDates = new Set(lockedDays.map((d) => d.scheduledDate))
    const openDates = dateRange.filter((d) => !lockedDates.has(d))

    if (openDates.length === 0) {
      return NextResponse.json({
        clientId,
        startDate,
        endDate,
        generatedCount: 0,
        skippedLockedCount: lockedDays.length,
      } satisfies GeneratePostsResponse)
    }

    // Read rejection counts BEFORE Claude call (read-only, no mutation)
    const rejectionCounts = readRejectionCounts(db, clientId, openDates)

    // Load client profile
    // TODO(v2): Load from DB by clientId instead of hardcoded import
    const clientProfile = cafeDeHoek

    // Load analyzed photos
    const anthropic = getAnthropicClient()
    const photoRows = await db
      .select()
      .from(photos)
      .where(eq(photos.clientId, clientId))

    const unanalyzedCount = photoRows.filter((p) => p.analysis === null).length
    if (unanalyzedCount > 0) {
      console.warn(
        `[generate-posts] Skipping ${unanalyzedCount} unanalyzed photo(s) for client ${clientId}`
      )
    }

    const analyzedPhotos: AnalyzedPhoto[] = photoRows
      .filter(
        (p): p is typeof p & { analysis: PhotoAnalysis } =>
          p.analysis !== null
      )
      .map((p) => ({
        id: p.id,
        blobUrl: p.blobUrl,
        analysis: p.analysis,
      }))

    // Build locked-day context for the plan prompt
    const lockedDaysContext = buildLockedDaysContext(lockedDays, openDates)

    // Stage 1: Generate content plan
    const planResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: buildPlanSystemPrompt(analyzedPhotos.length),
      messages: [
        {
          role: "user",
          content: buildPlanUserPrompt(
            clientProfile,
            analyzedPhotos,
            lockedDaysContext
          ),
        },
      ],
    })

    const planText = planResponse.content.find((b) => b.type === "text")
    if (!planText || planText.type !== "text") {
      return NextResponse.json(
        { error: "No text in plan response" },
        { status: 500 }
      )
    }

    let plan: WeeklyPlan
    try {
      plan = extractJSON<WeeklyPlan>(planText.text)
    } catch {
      return NextResponse.json(
        { error: "Failed to parse plan JSON", raw: planText.text },
        { status: 500 }
      )
    }

    // Stage 2: Write posts
    const photoMap = new Map(analyzedPhotos.map((p) => [p.id, p]))
    const photoDays = plan.days.filter(
      (d) => d.photoId && photoMap.has(d.photoId)
    )

    const writeContent: Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "url"; url: string } }
    > = []

    for (const day of photoDays) {
      const photo = photoMap.get(day.photoId!)!
      writeContent.push({
        type: "image",
        source: { type: "url", url: photo.blobUrl },
      })
      writeContent.push({
        type: "text",
        text: `[Photo for ${day.day} — ID: ${photo.id}]`,
      })
    }

    writeContent.push({
      type: "text",
      text: buildWriteUserPrompt(clientProfile, plan.days, analyzedPhotos),
    })

    const writeResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: buildWriteSystemPrompt(clientProfile),
      messages: [{ role: "user", content: writeContent }],
    })

    const writeText = writeResponse.content.find((b) => b.type === "text")
    if (!writeText || writeText.type !== "text") {
      return NextResponse.json(
        { error: "No text in write response" },
        { status: 500 }
      )
    }

    let rawPosts: { posts: Omit<DayPosts, "warnings">[] }
    try {
      rawPosts = extractJSON<{ posts: Omit<DayPosts, "warnings">[] }>(
        writeText.text
      )
    } catch {
      return NextResponse.json(
        { error: "Failed to parse posts JSON", raw: writeText.text },
        { status: 500 }
      )
    }

    // Validate posts
    const validatedPosts = validatePosts(
      rawPosts.posts,
      clientProfile.bannedPhrases
    )

    // Convert Claude output to per-platform DB rows
    const postRows: Array<{
      clientId: string
      platform: Platform
      scheduledDate: string
      content: string
      photoId: string | null
      reasoning: string
      rejectionCount: number
    }> = []

    for (const post of validatedPosts) {
      const dayPlan = plan.days.find((d) => d.day === post.day)
      const photoId = dayPlan?.photoId ?? null
      const scheduledDate = dayNameToDate(post.day, startDate)

      // Instagram row
      postRows.push({
        clientId,
        platform: "instagram",
        scheduledDate,
        content: post.instagramCaption,
        photoId,
        reasoning: post.reasoning,
        rejectionCount:
          rejectionCounts.get(`${scheduledDate}:instagram`) ?? 0,
      })

      // Facebook row
      postRows.push({
        clientId,
        platform: "facebook",
        scheduledDate,
        content: post.facebookPost,
        photoId,
        reasoning: post.reasoning,
        rejectionCount:
          rejectionCounts.get(`${scheduledDate}:facebook`) ?? 0,
      })
    }

    // Atomically delete old posts and insert new ones.
    // If this fails, old posts are preserved (no partial state).
    replacePostsForOpenDays(db, clientId, openDates, postRows)

    const response: GeneratePostsResponse = {
      clientId,
      startDate,
      endDate,
      generatedCount: postRows.length,
      skippedLockedCount: lockedDays.length,
    }

    return NextResponse.json(response)
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
