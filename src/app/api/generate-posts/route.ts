import { NextResponse } from "next/server"
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
import type {
  WeeklyPlan,
  DayPosts,
  GenerationResult,
  AnalyzedPhoto,
  PhotoAnalysis,
} from "@/lib/ai/types"

const MODEL = "claude-sonnet-4-6"
const CAFE_DE_HOEK_CLIENT_ID = "cafe-de-hoek-placeholder"

export const maxDuration = 60

export async function POST() {
  try {
    const anthropic = getAnthropicClient()

    // Load analyzed photos for this client
    const photoRows = await db
      .select()
      .from(photos)
      .where(eq(photos.clientId, CAFE_DE_HOEK_CLIENT_ID))

    // Filter to only analyzed photos — unanalyzed ones are skipped
    const unanalyzedCount = photoRows.filter((p) => p.analysis === null).length
    if (unanalyzedCount > 0) {
      console.warn(
        `[generate-posts] Skipping ${unanalyzedCount} unanalyzed photo(s) for client ${CAFE_DE_HOEK_CLIENT_ID}`
      )
    }

    const analyzedPhotos: AnalyzedPhoto[] = photoRows
      .filter((p): p is typeof p & { analysis: PhotoAnalysis } =>
        p.analysis !== null
      )
      .map((p) => ({
        id: p.id,
        blobUrl: p.blobUrl,
        analysis: p.analysis,
      }))

    // Stage 1: Generate content plan (text only — no vision cost)
    const planResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: buildPlanSystemPrompt(analyzedPhotos.length),
      messages: [
        {
          role: "user",
          content: buildPlanUserPrompt(cafeDeHoek, analyzedPhotos),
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

    // Build photo map for write stage
    const photoMap = new Map(analyzedPhotos.map((p) => [p.id, p]))

    // Stage 2: Write posts based on plan
    // Build content array — include photos for photo days via vision API
    const photoDays = plan.days.filter(
      (d) => d.photoId && photoMap.has(d.photoId)
    )
    const writeContent: Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "url"; url: string } }
    > = []

    // Add photos for photo days so Claude can see them
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

    // Add the main write prompt
    writeContent.push({
      type: "text",
      text: buildWriteUserPrompt(cafeDeHoek, plan.days, analyzedPhotos),
    })

    const writeResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: buildWriteSystemPrompt(cafeDeHoek),
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

    // Validate posts against hard constraints
    const validatedPosts = validatePosts(
      rawPosts.posts,
      cafeDeHoek.bannedPhrases
    )

    // Attach photo info to each post based on the plan
    const postsWithPhotos: DayPosts[] = validatedPosts.map((post) => {
      const dayPlan = plan.days.find((d) => d.day === post.day)
      const photoId = dayPlan?.photoId ?? null
      const photo = photoId ? photoMap.get(photoId) : null
      return {
        ...post,
        photoId,
        photoUrl: photo?.blobUrl ?? null,
      }
    })

    const result: GenerationResult = {
      client: {
        name: cafeDeHoek.name,
        type: cafeDeHoek.type,
        location: cafeDeHoek.location,
      },
      plan: plan.days,
      posts: postsWithPhotos,
      metadata: {
        generatedAt: new Date().toISOString(),
        model: MODEL,
        planInputTokens: planResponse.usage.input_tokens,
        planOutputTokens: planResponse.usage.output_tokens,
        postsInputTokens: writeResponse.usage.input_tokens,
        postsOutputTokens: writeResponse.usage.output_tokens,
        photosUsed: photoDays.length,
      },
    }

    return NextResponse.json(result)
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
