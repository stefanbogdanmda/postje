import type { DayPosts, PostWarning } from "./types"

const MAX_SENTENCE_WORDS = 15

/**
 * Splits text into sentences (Dutch-aware: handles abbreviations poorly,
 * but good enough for a prototype).
 */
function splitSentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * Validates a set of generated posts against hard constraints.
 * Returns posts with a warnings array attached to each day.
 */
export function validatePosts(
  posts: Omit<DayPosts, "warnings">[],
  bannedPhrases: string[]
): DayPosts[] {
  return posts.map((post) => {
    const warnings: PostWarning[] = []

    // Check both platforms
    const platforms: Array<{
      key: "instagram" | "facebook"
      text: string
    }> = [
      { key: "instagram", text: post.instagramCaption },
      { key: "facebook", text: post.facebookPost },
    ]

    for (const { key, text } of platforms) {
      const lower = text.toLowerCase()

      // Banned phrase check
      for (const phrase of bannedPhrases) {
        if (lower.includes(phrase.toLowerCase())) {
          warnings.push({
            type: "banned_phrase",
            platform: key,
            detail: `Contains banned phrase: "${phrase}"`,
          })
        }
      }

      // Sentence length check
      const sentences = splitSentences(text)
      for (const sentence of sentences) {
        const wordCount = sentence.split(/\s+/).length
        if (wordCount > MAX_SENTENCE_WORDS) {
          warnings.push({
            type: "long_sentence",
            platform: key,
            detail: `Sentence has ${wordCount} words (max ${MAX_SENTENCE_WORDS}): "${sentence.slice(0, 60)}…"`,
          })
        }
      }
    }

    return { ...post, warnings }
  })
}
