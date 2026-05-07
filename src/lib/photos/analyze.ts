import { getAnthropicClient } from "@/lib/ai/client"
import { extractJSON } from "@/lib/ai/extract-json"
import type { PhotoAnalysis } from "@/lib/ai/types"

const MODEL = "claude-sonnet-4-6"

const ANALYSIS_SYSTEM_PROMPT = `You are a photo analyst for a social media management platform. You analyze photos uploaded by small business clients to help generate social media posts.

Your job: look at the photo and produce a structured analysis that a content writer can use to write authentic, grounded social media posts.

Focus on:
- What's literally in the photo (subjects, objects, people, food, setting)
- The mood and atmosphere the photo conveys
- Any seasonal cues (weather, decorations, lighting, clothing)
- The physical setting (indoor/outdoor, type of space)
- How this photo could connect to a small business brand (angles for posts)
- A rich visual description capturing details a writer might reference

Respond with valid JSON only. No markdown, no explanation outside the JSON.`

function buildAnalysisUserPrompt(): string {
  return `Analyze this photo and respond with this exact JSON structure:
{
  "subjects": ["list", "of", "things", "in", "the", "photo"],
  "mood": "one or two words describing the emotional tone",
  "season": "season if detectable, or null",
  "setting": "where the photo was taken",
  "brandAngles": ["angle1", "angle2", "angle3"],
  "visualDetails": "One paragraph with rich visual description — colors, textures, composition, lighting, anything a writer could reference."
}`
}

export async function analyzePhoto(
  blobUrl: string
): Promise<PhotoAnalysis> {
  const client = getAnthropicClient()

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: ANALYSIS_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "url",
              url: blobUrl,
            },
          },
          {
            type: "text",
            text: buildAnalysisUserPrompt(),
          },
        ],
      },
    ],
  })

  const textBlock = response.content.find((b) => b.type === "text")
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in analysis response")
  }

  return extractJSON<PhotoAnalysis>(textBlock.text)
}
