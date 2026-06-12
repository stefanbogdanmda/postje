// Helpers for the client brand-voice form fields. These live in their own
// module (not the "use server" actions file, which may only export async
// functions) so they can be unit-tested directly.

/**
 * Parse a textarea where each non-empty line is one item — used for the
 * banned-phrases list. Trims each line and drops blanks.
 */
export function parseLines(value: string | null): string[] {
  if (!value) return []
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Parse a textarea where each example post is separated by a blank line, so a
 * single example can span multiple sentences/lines. Trims each block and drops
 * blanks.
 */
export function parseExamplePosts(value: string | null): string[] {
  if (!value) return []
  return value
    .split(/\n\s*\n/)
    .map((post) => post.trim())
    .filter(Boolean)
}
