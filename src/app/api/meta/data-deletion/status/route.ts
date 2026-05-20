import { NextResponse } from "next/server"

/**
 * Data Deletion Status Check
 *
 * Meta shows users a link to check the status of their deletion request.
 * For v1, we respond that deletion has been processed. When the product
 * scales, this should look up the confirmation code in a database table
 * and return the actual status (pending / completed).
 */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")

  if (!code) {
    return NextResponse.json(
      { error: "Missing confirmation code" },
      { status: 400 }
    )
  }

  return NextResponse.json({
    confirmation_code: code,
    status: "completed",
    message:
      "Je gegevens bij Postje zijn verwijderd. " +
      "Als je vragen hebt, neem contact op via privacy@postje.nl.",
  })
}
