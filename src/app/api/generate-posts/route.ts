import { z } from "zod"
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { clients, photos } from "@/db/schema"
import { eq } from "drizzle-orm"
import { getAnthropicClient } from "@/lib/ai/client"
import {
  buildPlanSystemPrompt,
  buildPlanUserPrompt,
  buildWriteSystemPrompt,
  buildWriteUserPrompt,
} from "@/lib/ai/prompts"
import { extractJSON } from "@/lib/ai/extract-json"
import { runPostQualityLoop } from "@/lib/ai/post-quality-loop"
import { rewriteDayPost } from "@/lib/ai/rewrite-day-post"
import { buildClientProfile } from "@/lib/ai/client-profile"
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
import type { GeneratePostsResponse } from "@/lib/posts/types"
import type { Platform } from "@/lib/posts/config"
import { requireClientAccess, toErrorResponse } from "@/lib/authorization"
import { rateLimitRequest } from "@/lib/request-rate-limit"
import { parseBody } from "@/lib/validation"

const generatePostsSchema = z.object({
  clientId: z.string().min(1, "clientId is required"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must use YYYY-MM-DD format"),
})

const MODEL = "claude-sonnet-4-6"

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const rateLimited = await rateLimitRequest(
      request,
      "generate-posts",
      5,
      15 * 60 * 1000
    )
    if (rateLimited) return rateLimited

    // Parse and validate request
    const parsed = await parseBody(request, generatePostsSchema)
    if ("error" in parsed) return parsed.error
    const { clientId: requestedClientId, startDate } = parsed.data

    const { clientId } = await requireClientAccess(requestedClientId)

    const dateRange = getDateRange(startDate)
    const endDate = dateRange[dateRange.length - 1]

    // Identify locked and open days
    const lockedDays = await getLockedDays(db, clientId, startDate, endDate)
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
    const rejectionCounts = await readRejectionCounts(db, clientId, openDates)

    // Load client profile
    const clientRows = await db
      .select({
        businessName: clients.businessName,
        location: clients.location,
        industry: clients.industry,
        businessType: clients.businessType,
        productsServices: clients.productsServices,
        toneOfVoice: clients.toneOfVoice,
        targetCustomers: clients.targetCustomers,
        brandPersonality: clients.brandPersonality,
        bannedPhrases: clients.bannedPhrases,
        examplePosts: clients.examplePosts,
      })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1)
    const clientRow = clientRows[0]

    if (!clientRow) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }

    const clientProfile = buildClientProfile(clientRow)

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
      console.error("[generate-posts] Failed to parse plan JSON", {
        clientId,
        raw: planText.text,
      })
      return NextResponse.json(
        { error: "Failed to parse plan JSON" },
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
      console.error("[generate-posts] Failed to parse posts JSON", {
        clientId,
        raw: writeText.text,
      })
      return NextResponse.json(
        { error: "Failed to parse posts JSON" },
        { status: 500 }
      )
    }

    // Validate + self-correct: run the quality loop. Each day is rewritten
    // (up to 2 retries) whenever validation surfaces a warning. Days that
    // are already clean cost zero extra API calls.
    const loopResult = await runPostQualityLoop(rawPosts.posts, {
      bannedPhrases: clientProfile.bannedPhrases,
      rewrite: (draft, feedback) =>
        rewriteDayPost(anthropic, clientProfile, draft, feedback),
    })
    const validatedPosts = loopResult.posts

    console.log(
      `[generate-posts] quality loop for client ${clientId}:`,
      loopResult.attempts
        .map((a) => `${a.day}=${a.attempts}${a.clean ? "✓" : "✗"}`)
        .join(" ")
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

    const openDatesSet = new Set(openDates)
    let droppedLockedCount = 0

    for (const post of validatedPosts) {
      const scheduledDate = dayNameToDate(post.day, startDate)

      // Skip posts for locked days — Claude sometimes plans them despite
      // being told not to. The unique index would reject them anyway.
      if (!openDatesSet.has(scheduledDate)) {
        droppedLockedCount++
        continue
      }

      const dayPlan = plan.days.find((d) => d.day === post.day)
      const photoId = dayPlan?.photoId ?? null

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

    if (droppedLockedCount > 0) {
      console.warn(
        `[generate-posts] Claude planned content for ${droppedLockedCount} locked day(s); dropped before insert`
      )
    }

    // Atomically delete old posts and insert new ones.
    // If this fails, old posts are preserved (no partial state).
    await replacePostsForOpenDays(db, clientId, openDates, postRows)

    const response: GeneratePostsResponse = {
      clientId,
      startDate,
      endDate,
      generatedCount: postRows.length,
      skippedLockedCount: lockedDays.length,
    }

    return NextResponse.json(response)
  } catch (error: unknown) {
    return toErrorResponse(error)
  }
}
