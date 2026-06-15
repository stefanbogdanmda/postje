import { validatePosts } from "./validate-posts"
import type { DayPosts, PostWarning } from "./types"

/** A validated day-post without the DB-only fields (carries `warnings`). */
export type ValidatedDayPost = Omit<DayPosts, "photoId" | "photoUrl">

/** The bare fields validatePosts accepts (no warnings/photo fields). */
type WritableDay = Omit<DayPosts, "warnings" | "photoId" | "photoUrl">

/**
 * Turn the validator's warnings into a short, human/LLM-readable instruction
 * for the rewrite. Empty string when there's nothing to fix.
 */
export function summarizeViolations(warnings: PostWarning[]): string {
  const banned = [
    ...new Set(
      warnings.filter((w) => w.type === "banned_phrase").map((w) => w.detail)
    ),
  ]
  const hasLong = warnings.some((w) => w.type === "long_sentence")
  const parts: string[] = []
  if (banned.length > 0) {
    parts.push(`Remove these banned phrases — ${banned.join("; ")}.`)
  }
  if (hasLong) {
    parts.push("Some sentences are too long. Keep EVERY sentence under 15 words.")
  }
  return parts.join(" ")
}

export function buildCorrectionUserPrompt(
  day: ValidatedDayPost,
  violations: string
): string {
  return `One of this week's posts for ${day.day} broke a hard rule. Rewrite BOTH platforms so they pass, keeping the same topic, angle and voice.

Fix this:
${violations}

Current Instagram caption:
${day.instagramCaption}

Current Facebook post:
${day.facebookPost}

Respond with valid JSON only, no markdown:
{ "instagramCaption": "Dutch caption", "facebookPost": "Dutch post" }`
}

/** Injected rewrite function — real impl calls Claude; tests pass a fake. */
export type DayRegenerator = (
  day: ValidatedDayPost,
  violations: string
) => Promise<{ instagramCaption: string; facebookPost: string }>

export const MAX_CORRECTION_ROUNDS = 1

/**
 * For each post that tripped a validator warning, ask the writer to rewrite it
 * and re-validate. Keep a rewrite only if it has strictly fewer warnings than
 * what we had (so we never make a post worse), up to `maxRounds` attempts. A
 * regeneration error leaves the original in place. Returns the (possibly
 * corrected) posts plus the list of days that improved.
 *
 * This turns the validator from "detect and persist anyway" into "detect and
 * fix" — the guardrail now has a consequence.
 */
export async function correctFlaggedPosts(
  validated: ValidatedDayPost[],
  bannedPhrases: string[],
  regenerate: DayRegenerator,
  maxRounds: number = MAX_CORRECTION_ROUNDS
): Promise<{ posts: ValidatedDayPost[]; correctedDays: string[] }> {
  const out: ValidatedDayPost[] = []
  const correctedDays: string[] = []

  for (const post of validated) {
    let best = post
    for (let round = 0; round < maxRounds && best.warnings.length > 0; round++) {
      let candidate: ValidatedDayPost
      try {
        const rewritten = await regenerate(best, summarizeViolations(best.warnings))
        const writable: WritableDay = {
          day: best.day,
          instagramCaption: rewritten.instagramCaption,
          facebookPost: rewritten.facebookPost,
          reasoning: best.reasoning,
          englishSummary: best.englishSummary,
        }
        candidate = validatePosts([writable], bannedPhrases)[0]
      } catch {
        break // regeneration failed — keep the best we have
      }
      if (candidate.warnings.length < best.warnings.length) {
        best = candidate
      } else {
        break // no improvement — stop burning calls
      }
    }
    if (best !== post) correctedDays.push(best.day)
    out.push(best)
  }

  return { posts: out, correctedDays }
}
