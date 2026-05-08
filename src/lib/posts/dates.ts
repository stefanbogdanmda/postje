/**
 * Day offsets from the week start (Tuesday).
 * The plan prompt generates Tuesday through Monday.
 */
const DAY_OFFSETS: Record<string, number> = {
  Tuesday: 0,
  Wednesday: 1,
  Thursday: 2,
  Friday: 3,
  Saturday: 4,
  Sunday: 5,
  Monday: 6,
}

/**
 * Convert a day name ("Tuesday") to an ISO date string, given
 * the week's start date (which must be a Tuesday).
 */
export function dayNameToDate(dayName: string, startDate: string): string {
  const offset = DAY_OFFSETS[dayName]
  if (offset === undefined) {
    throw new Error(`Unknown day name: "${dayName}"`)
  }
  const date = new Date(startDate + "T00:00:00Z")
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().split("T")[0]
}

/**
 * Return an array of 7 ISO date strings starting from startDate.
 */
export function getDateRange(startDate: string): string[] {
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(startDate + "T00:00:00Z")
    date.setUTCDate(date.getUTCDate() + i)
    dates.push(date.toISOString().split("T")[0])
  }
  return dates
}
