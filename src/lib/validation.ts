import { z } from "zod"
import { NextResponse } from "next/server"

/**
 * Parse and validate a JSON request body against a Zod schema.
 *
 * Returns either `{ data }` with the validated & typed payload,
 * or `{ error }` with a 400 NextResponse ready to return.
 */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T
): Promise<{ data: z.infer<T> } | { error: NextResponse }> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return {
      error: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    }
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    return {
      error: NextResponse.json(
        { error: "Validation error", details: result.error.flatten().fieldErrors },
        { status: 400 }
      ),
    }
  }
  return { data: result.data }
}
