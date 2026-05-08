import type { LockedDay } from "./types"

/**
 * Build the locked-day context string to append to the plan user prompt.
 * Returns empty string if there are no locked days (normal full-week generation).
 *
 * This is appended via string concatenation — no structural changes to the prompt.
 */
export function buildLockedDaysContext(
  lockedDays: LockedDay[],
  openDates: string[]
): string {
  if (lockedDays.length === 0) return ""

  const lockedLines = lockedDays
    .map((day) => {
      const photoInfo = day.hasPhoto ? "photo assigned" : "text-only"
      return `- ${day.scheduledDate}: ${photoInfo}`
    })
    .join("\n")

  const openLines = openDates.map((date) => `- ${date}`).join("\n")

  return `

The following days are already planned and locked. Do not change them.
Plan new content only for the open days listed after.

LOCKED:
${lockedLines}

OPEN (plan these):
${openLines}`
}
