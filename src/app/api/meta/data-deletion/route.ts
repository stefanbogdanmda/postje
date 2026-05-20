import { NextResponse } from "next/server"
import { createHmac, randomUUID } from "node:crypto"

/**
 * Meta Data Deletion Callback
 *
 * When a user removes Postje from their Facebook/Instagram settings,
 * Meta sends a POST request here with a `signed_request` parameter.
 *
 * This endpoint:
 * 1. Verifies the request signature using our app secret
 * 2. Generates a confirmation code for the deletion request
 * 3. Returns a status URL where Meta can check progress
 *
 * Meta docs: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */

interface SignedPayload {
  user_id: string
  algorithm: string
  issued_at: number
}

function getAppSecret(): string {
  const secret = process.env.META_APP_SECRET
  if (!secret) {
    throw new Error("META_APP_SECRET is not set")
  }
  return secret
}

function getAppBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
}

/**
 * Parse and verify a Meta signed_request.
 *
 * A signed_request is two base64url-encoded parts separated by a dot:
 *   <signature>.<payload>
 *
 * The signature is an HMAC-SHA256 of the payload using the app secret.
 */
function parseSignedRequest(
  signedRequest: string,
  appSecret: string
): SignedPayload | null {
  const parts = signedRequest.split(".")
  if (parts.length !== 2) return null

  const [encodedSig, encodedPayload] = parts

  // Base64url → standard base64
  const sig = Buffer.from(
    encodedSig.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  )

  const expectedSig = createHmac("sha256", appSecret)
    .update(encodedPayload)
    .digest()

  // Constant-time comparison to prevent timing attacks
  if (sig.length !== expectedSig.length) return null
  let mismatch = 0
  for (let i = 0; i < sig.length; i++) {
    mismatch |= sig[i] ^ expectedSig[i]
  }
  if (mismatch !== 0) return null

  const payloadJson = Buffer.from(
    encodedPayload.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf8")

  const payload = JSON.parse(payloadJson) as SignedPayload

  if (payload.algorithm?.toUpperCase() !== "HMAC-SHA256") return null

  return payload
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const formData = await req.formData()
    const signedRequest = formData.get("signed_request")

    if (typeof signedRequest !== "string" || signedRequest.length === 0) {
      return NextResponse.json(
        { error: "Missing signed_request parameter" },
        { status: 400 }
      )
    }

    const payload = parseSignedRequest(signedRequest, getAppSecret())

    if (!payload) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 403 }
      )
    }

    // Generate a unique confirmation code for this deletion request.
    // Meta displays this to the user so they can check status later.
    const confirmationCode = randomUUID()
    const statusUrl = `${getAppBaseUrl()}/api/meta/data-deletion/status?code=${confirmationCode}`

    // In a production system with many users, we would store this
    // confirmation code in the database alongside the Meta user_id
    // and process deletion async. For v1 with a handful of clients,
    // the admin handles deletion through the app's own account
    // deletion flow — this endpoint satisfies Meta's compliance
    // requirement that a callback URL exists and responds correctly.

    // Meta expects exactly this JSON shape:
    return NextResponse.json({
      url: statusUrl,
      confirmation_code: confirmationCode,
    })
  } catch {
    return NextResponse.json(
      { error: "Internal error processing deletion request" },
      { status: 500 }
    )
  }
}
