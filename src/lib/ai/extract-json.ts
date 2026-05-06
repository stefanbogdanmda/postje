/**
 * Extracts JSON from a Claude response that might be wrapped in markdown
 * fences or have surrounding text. Finds the first { ... } or [ ... ] block.
 */
export function extractJSON<T>(raw: string): T {
  // Strip markdown fences if present
  let cleaned = raw.trim()
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim()
  }

  // If it still doesn't start with { or [, find the first occurrence
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const firstBrace = cleaned.indexOf("{")
    const firstBracket = cleaned.indexOf("[")
    const start = Math.min(
      firstBrace === -1 ? Infinity : firstBrace,
      firstBracket === -1 ? Infinity : firstBracket
    )
    if (start === Infinity) {
      throw new Error("No JSON object or array found in response")
    }
    cleaned = cleaned.slice(start)
  }

  return JSON.parse(cleaned) as T
}
