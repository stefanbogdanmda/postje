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

function parseIsoDateParts(date: string): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number)
  if (!year || !month || !day) {
    throw new Error(`Invalid ISO date: "${date}"`)
  }
  return [year, month, day]
}

function formatUtcDate(date: Date): string {
  return date.toISOString().split("T")[0]
}

function addDays(date: string, days: number): string {
  const [year, month, day] = parseIsoDateParts(date)
  const value = new Date(Date.UTC(year, month - 1, day))
  value.setUTCDate(value.getUTCDate() + days)
  return formatUtcDate(value)
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
  return addDays(startDate, offset)
}

/**
 * Return an array of 7 ISO date strings starting from startDate.
 */
export function getDateRange(startDate: string): string[] {
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    dates.push(addDays(startDate, i))
  }
  return dates
}

export function formatLocalDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

export function getGenerationWeekStart(date: Date = new Date()): string {
  const day = date.getDay()
  const diff = day >= 2 ? 2 - day : 2 - day - 7
  const tuesday = new Date(date)
  tuesday.setDate(date.getDate() + diff)
  return formatLocalDate(tuesday)
}

export function getGenerationWeekRange(date: Date = new Date()): {
  startDate: string
  endDate: string
} {
  const startDate = getGenerationWeekStart(date)
  return {
    startDate,
    endDate: addDays(startDate, 6),
  }
}
