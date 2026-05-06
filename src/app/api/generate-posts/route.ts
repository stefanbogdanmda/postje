import { NextResponse } from "next/server"
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
import type { WeeklyPlan, DayPosts, GenerationResult } from "@/lib/ai/types"

const MODEL = "claude-sonnet-4-6"

export async function GET() {
  try {
    const client = getAnthropicClient()

    // Stage 1: Generate content plan
    const planResponse = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: buildPlanSystemPrompt(),
      messages: [{ role: "user", content: buildPlanUserPrompt(cafeDeHoek) }],
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

    // Stage 2: Write posts based on plan
    const writeResponse = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: buildWriteSystemPrompt(cafeDeHoek),
      messages: [
        {
          role: "user",
          content: buildWriteUserPrompt(cafeDeHoek, plan.days),
        },
      ],
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
      rawPosts = extractJSON<{ posts: Omit<DayPosts, "warnings">[] }>(writeText.text)
    } catch {
      return NextResponse.json(
        { error: "Failed to parse posts JSON", raw: writeText.text },
        { status: 500 }
      )
    }

    // Validate posts against hard constraints
    const validatedPosts = validatePosts(rawPosts.posts, cafeDeHoek.bannedPhrases)

    const result: GenerationResult = {
      client: {
        name: cafeDeHoek.name,
        type: cafeDeHoek.type,
        location: cafeDeHoek.location,
      },
      plan: plan.days,
      posts: validatedPosts,
      metadata: {
        generatedAt: new Date().toISOString(),
        model: MODEL,
        planInputTokens: planResponse.usage.input_tokens,
        planOutputTokens: planResponse.usage.output_tokens,
        postsInputTokens: writeResponse.usage.input_tokens,
        postsOutputTokens: writeResponse.usage.output_tokens,
      },
    }

    return NextResponse.json(result)
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
