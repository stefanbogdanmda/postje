const BUSINESS_HOURS_START = 9 // 09:00 inclusive
const BUSINESS_HOURS_END = 18 // 18:00 exclusive
const TIMEZONE = "Europe/Amsterdam"

const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"])

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  weekday: "short",
  hour: "numeric",
  hour12: false,
})

/**
 * Returns true if the given moment falls within Dutch business hours:
 * Monday through Friday, 09:00 (inclusive) to 18:00 (exclusive),
 * Europe/Amsterdam time. Handles DST automatically via Intl.
 */
export function isWithinNLBusinessHours(now: Date): boolean {
  const parts = formatter.formatToParts(now)

  const weekday = parts.find((p) => p.type === "weekday")?.value
  const hourString = parts.find((p) => p.type === "hour")?.value

  if (!weekday || !hourString) return false

  if (!WEEKDAYS.has(weekday)) return false

  // Intl with hour12: false returns "24" for midnight in some locales — coerce.
  const hour = hourString === "24" ? 0 : parseInt(hourString, 10)

  return hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END
}
