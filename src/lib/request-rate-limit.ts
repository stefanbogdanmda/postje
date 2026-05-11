import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { isKeyRateLimited } from "./auth/throttle"

function getIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  )
}

export async function rateLimitRequest(
  request: NextRequest,
  scope: string,
  maxRequests: number,
  windowMs: number
): Promise<NextResponse | null> {
  const key = `${scope}:${getIp(request)}`
  const limited = await isKeyRateLimited(
    key,
    { maxRequests, windowMs },
    { db }
  )

  if (!limited) {
    return null
  }

  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    { status: 429 }
  )
}
