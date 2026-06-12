import { NextResponse } from "next/server"
import { db } from "@/db"
import {
  getDeletionRequestByCode,
  buildDeletionStatusResponse,
} from "@/lib/meta/data-deletion"

/**
 * Data Deletion Status Check
 *
 * Meta links the user here to check the status of their deletion request. We
 * look the confirmation code up and report the real state — "pending" while
 * the operator still has to resolve it via the in-app GDPR flow, "completed"
 * once resolved, "not_found" for an unknown code. We never claim a deletion
 * happened when it hasn't.
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

  const request = await getDeletionRequestByCode(db, code)
  const { httpStatus, body } = buildDeletionStatusResponse(request, code)
  return NextResponse.json(body, { status: httpStatus })
}
