import { eq } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import * as schema from "@/db/schema"

type Db = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export type DeletionRequestStatus = "received" | "resolved"

/**
 * Record an incoming Meta data-deletion request so its status URL can later
 * report the real state. Keyed by the confirmation code we return to Meta.
 */
export async function recordDeletionRequest(
  db: Db,
  input: { metaUserId: string; confirmationCode: string }
): Promise<void> {
  await db.insert(schema.metaDeletionRequests).values({
    metaUserId: input.metaUserId,
    confirmationCode: input.confirmationCode,
  })
}

export async function getDeletionRequestByCode(
  db: Db,
  confirmationCode: string
): Promise<{ confirmationCode: string; status: DeletionRequestStatus } | null> {
  const rows = await db
    .select({
      confirmationCode: schema.metaDeletionRequests.confirmationCode,
      status: schema.metaDeletionRequests.status,
    })
    .from(schema.metaDeletionRequests)
    .where(eq(schema.metaDeletionRequests.confirmationCode, confirmationCode))
    .limit(1)
  return rows[0] ?? null
}

export interface DeletionStatusResponse {
  httpStatus: number
  body: {
    confirmation_code: string
    status: "pending" | "completed" | "not_found"
    message: string
  }
}

/**
 * Build the honest status response Meta (and the user) sees. We never claim a
 * deletion is "completed" unless the operator has actually resolved it; an
 * unresolved request reports "pending", and an unknown code reports
 * "not_found". Pure function so it can be unit-tested without a DB or HTTP.
 */
export function buildDeletionStatusResponse(
  request: { confirmationCode: string; status: DeletionRequestStatus } | null,
  code: string
): DeletionStatusResponse {
  if (!request) {
    return {
      httpStatus: 404,
      body: {
        confirmation_code: code,
        status: "not_found",
        message:
          "We konden geen verwijderverzoek vinden met deze code. " +
          "Neem contact op via privacy@postje.nl.",
      },
    }
  }

  if (request.status === "resolved") {
    return {
      httpStatus: 200,
      body: {
        confirmation_code: request.confirmationCode,
        status: "completed",
        message:
          "Je gegevens bij Postje zijn verwijderd. " +
          "Vragen? Mail naar privacy@postje.nl.",
      },
    }
  }

  return {
    httpStatus: 200,
    body: {
      confirmation_code: request.confirmationCode,
      status: "pending",
      message:
        "We hebben je verwijderverzoek ontvangen en handelen het af. " +
        "Wil je dit versnellen of heb je vragen? Mail naar privacy@postje.nl.",
    },
  }
}
