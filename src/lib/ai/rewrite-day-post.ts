import type Anthropic from "@anthropic-ai/sdk"
import { extractJSON } from "./extract-json"
import type { ClientProfile } from "./types"
import type { DayPostDraft } from "./post-quality-loop"

const MODEL = "claude-sonnet-4-6"
const MAX_TOKENS = 1500

interface RewriteResponse {
  instagramCaption: string
  facebookPost: string
  reasoning: string
  englishSummary: string
}

/**
 * Asks Claude to rewrite both captions for one day given concrete feedback
 * about what failed validation. Returns a fresh draft for the same day.
 *
 * Used as the `rewrite` callback inside `runPostQualityLoop`.
 */
export async function rewriteDayPost(
  anthropic: Anthropic,
  client: ClientProfile,
  draft: DayPostDraft,
  feedback: string
): Promise<DayPostDraft> {
  const bannedList = client.bannedPhrases
    .map((p) => `"${p}"`)
    .join(", ")

  const systemPrompt = `You are ${client.ownerPersona.name}, the owner of ${client.name} in ${client.location}. You are rewriting two social media captions because they failed an internal quality check.

Voice rules:
- ${client.ownerPersona.style}
- Write in ${client.postLanguage}.
- No sentence over 15 words. Count before you write. This is a hard rule, not a suggestion.
- Use emojis sparingly — one or two per post maximum.
- Never use these phrases: ${bannedList}

Respond with valid JSON only. No markdown, no explanation outside the JSON.`

  const userPrompt = `Rewrite both captions for ${draft.day}. Keep the same general topic and angle — only fix the listed problems.

CURRENT INSTAGRAM CAPTION:
${draft.instagramCaption}

CURRENT FACEBOOK POST:
${draft.facebookPost}

PROBLEMS TO FIX:
${feedback}

Respond with this exact JSON structure:
{
  "instagramCaption": "new Instagram caption",
  "facebookPost": "new Facebook post",
  "reasoning": "Dutch reasoning for these new versions",
  "englishSummary": "one-line English summary of what these posts say"
}`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  })

  const textBlock = response.content.find((b) => b.type === "text")
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in rewrite response")
  }

  const parsed = extractJSON<RewriteResponse>(textBlock.text)

  return {
    day: draft.day,
    instagramCaption: parsed.instagramCaption,
    facebookPost: parsed.facebookPost,
    reasoning: parsed.reasoning,
    englishSummary: parsed.englishSummary,
  }
}
