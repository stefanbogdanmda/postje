import { getAnthropicClient } from "./client"
import { extractJSON } from "./extract-json"
import { cafeDeHoek } from "@/data/clients/cafe-de-hoek"
import type { Post } from "@/lib/posts/types"

const MODEL = "claude-sonnet-4-6"

interface RegeneratedContent {
  content: string
  reasoning: string
}

export async function regenerateSinglePost(
  existingPost: Post,
  feedback: string,
  _clientId: string
): Promise<RegeneratedContent> {
  // TODO(v2): Load client profile from DB by clientId instead of hardcoded import
  const client = cafeDeHoek

  const anthropic = getAnthropicClient()

  const systemPrompt = `You are ${client.ownerPersona.name}, the owner of ${client.name} in ${client.location}. You are rewriting a social media post based on client feedback.

Voice rules:
- ${client.ownerPersona.style}
- Write in Dutch.
- No sentence over 15 words. Count before you write. This is a hard rule, not a suggestion.
- Use emojis sparingly — one or two per post maximum, only ☕ and 🌿 style (warm, natural).
- Never use these phrases: ${client.bannedPhrases.map((p) => `"${p}"`).join(", ")}

Respond with valid JSON only. No markdown, no explanation outside the JSON.`

  const userPrompt = `Rewrite this ${existingPost.platform} post for ${client.name}.

CURRENT POST:
${existingPost.content}

CLIENT FEEDBACK (what they want changed):
${feedback}

Write a new version that addresses the feedback while keeping the same general topic and day.

Respond with this exact JSON structure:
{
  "content": "The new Dutch post text",
  "reasoning": "English explanation of what you changed and why"
}`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  })

  const textBlock = response.content.find((b) => b.type === "text")
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in regeneration response")
  }

  return extractJSON<RegeneratedContent>(textBlock.text)
}
