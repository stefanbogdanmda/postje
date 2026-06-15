import { getAnthropicClient } from "./client"
import { extractJSON } from "./extract-json"
import type { BrandVoiceDraft } from "./types"

const MODEL = "claude-sonnet-4-6"

/** Transcripts shorter than this aren't worth a Claude call. */
export const MIN_TRANSCRIPT_LENGTH = 80

export function buildExtractSystemPrompt(): string {
  return `You are helping onboard a small Dutch business onto Postje, a service that runs their social media. From a kickoff-call transcript, draft a "brand-voice profile" the writing AI will use to sound like this business.

Summarize ONLY what the transcript actually supports. Hard rules:
- Never invent banned phrases. List a phrase under "bannedPhrases" only if the client or interviewer explicitly said to avoid it. If none were mentioned, return an empty array.
- Example posts must be VERBATIM quotes from the transcript — things the client actually said about how they talk about their business. Never fabricate example posts. If there are none, return an empty array.
- Tone of voice, target customers and brand personality: describe what's evident, briefly. If something wasn't discussed, keep that field short or empty and say so in "notes". Do not pad with marketing language.
- Avoid corporate Dutch in your summaries. The fields may quote the business's own Dutch.
- "notes" is a short English remark on what you were confident about, what you guessed, and what was missing. It is for the human reviewer only.

Respond with VALID JSON only, no markdown, exactly this shape:
{
  "toneOfVoice": "string",
  "targetCustomers": "string",
  "brandPersonality": "string",
  "bannedPhrases": ["string"],
  "examplePosts": ["string"],
  "notes": "string"
}`
}

export function buildExtractUserPrompt(
  businessName: string,
  transcript: string
): string {
  return `Here is the kickoff-call transcript for ${businessName}:

"""
${transcript}
"""

Draft the brand-voice profile as JSON in the exact shape specified. Remember: no invented banned phrases, example posts must be real quotes, leave fields short/empty when the transcript doesn't support them.`
}

const asString = (v: unknown): string => (typeof v === "string" ? v.trim() : "")
const asStringArray = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
    : []

/**
 * Coerce arbitrary parsed JSON into a safe BrandVoiceDraft. This is the
 * guardrail layer: anything missing or the wrong type becomes an empty
 * string/array rather than throwing or leaking junk into the form. An empty
 * bannedPhrases/examplePosts list is the correct, safe default.
 */
export function normalizeDraft(raw: unknown): BrandVoiceDraft {
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    toneOfVoice: asString(o.toneOfVoice),
    targetCustomers: asString(o.targetCustomers),
    brandPersonality: asString(o.brandPersonality),
    bannedPhrases: asStringArray(o.bannedPhrases),
    examplePosts: asStringArray(o.examplePosts),
    notes: asString(o.notes),
  }
}

/**
 * Draft a brand-voice profile from a kickoff-call transcript. One Claude call;
 * the transcript is used transiently and never persisted by this function.
 * Throws on API/parse failure — the caller turns that into a friendly message.
 */
export async function extractBrandVoice(
  transcript: string,
  businessName: string
): Promise<BrandVoiceDraft> {
  const anthropic = getAnthropicClient()
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: buildExtractSystemPrompt(),
    messages: [
      { role: "user", content: buildExtractUserPrompt(businessName, transcript) },
    ],
  })

  const textBlock = response.content.find((b) => b.type === "text")
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in extraction response")
  }

  return normalizeDraft(extractJSON<unknown>(textBlock.text))
}
