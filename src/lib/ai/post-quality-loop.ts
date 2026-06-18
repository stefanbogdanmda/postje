import { validatePosts } from "./validate-posts"
import type { DayPosts } from "./types"

/** A day's post pair without the database-level fields. */
export type DayPostDraft = Omit<DayPosts, "warnings" | "photoId" | "photoUrl">

/** A draft after validation — same shape plus warnings. */
export type DayPostValidated = Omit<DayPosts, "photoId" | "photoUrl">

/**
 * Rewrites a single day's posts given feedback about what to fix.
 * Injected so the loop can be tested without calling the Anthropic API.
 */
export type RewriteDayFn = (
  draft: DayPostDraft,
  feedback: string
) => Promise<DayPostDraft>

export interface DayAttemptLog {
  day: string
  attempts: number
  clean: boolean
}

export interface QualityLoopResult {
  posts: DayPostValidated[]
  attempts: DayAttemptLog[]
}

export interface QualityLoopOptions {
  bannedPhrases: string[]
  rewrite: RewriteDayFn
  maxAttemptsPerDay?: number
}

const DEFAULT_MAX_ATTEMPTS = 3

/**
 * Runs the four-beat loop on each day independently:
 *   DO    — initial draft already produced upstream
 *   CHECK — validatePosts attaches warnings
 *   JUDGE — zero warnings means done
 *   FIX   — rewrite the day with warnings as feedback, then re-validate
 *
 * Days that already pass validation are returned untouched (1 attempt).
 * Days that never clear validation are returned with their final warnings
 * attached so the caller can still surface them — same fallback behavior
 * the system has today.
 */
export async function runPostQualityLoop(
  drafts: DayPostDraft[],
  options: QualityLoopOptions
): Promise<QualityLoopResult> {
  const { bannedPhrases, rewrite } = options
  const maxAttempts = options.maxAttemptsPerDay ?? DEFAULT_MAX_ATTEMPTS

  const posts: DayPostValidated[] = []
  const attempts: DayAttemptLog[] = []

  const initialValidated = validatePosts(drafts, bannedPhrases)

  for (const initial of initialValidated) {
    let current: DayPostValidated = initial
    let count = 1

    while (current.warnings.length > 0 && count < maxAttempts) {
      const feedback = formatFeedback(current.warnings)
      const rewritten = await rewrite(stripWarnings(current), feedback)
      const [revalidated] = validatePosts([rewritten], bannedPhrases)
      current = revalidated
      count++
    }

    posts.push(current)
    attempts.push({
      day: current.day,
      attempts: count,
      clean: current.warnings.length === 0,
    })
  }

  return { posts, attempts }
}

function formatFeedback(warnings: DayPostValidated["warnings"]): string {
  return warnings
    .map((w) => `- [${w.platform}] ${w.detail}`)
    .join("\n")
}

function stripWarnings(post: DayPostValidated): DayPostDraft {
  const { warnings: _warnings, ...rest } = post
  return rest
}
