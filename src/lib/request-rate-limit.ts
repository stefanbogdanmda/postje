import { NextRequest, NextResponse } from "next/server"
import { isKeyRateLimited } from "./rate-limit"

function getIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  )
}

export function rateLimitRequest(
  request: NextRequest,
  scope: string,
  maxRequests: number,
  windowMs: number
): NextResponse | null {
  const key = `${scope}:${getIp(request)}`
  if (!isKeyRateLimited(key, maxRequests, windowMs)) {
    return null
  }

  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    { status: 429 }
  )
}
