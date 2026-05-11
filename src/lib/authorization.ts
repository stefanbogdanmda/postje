import { auth } from "@/lib/auth"
import { db } from "@/db"
import { clients } from "@/db/schema"
import { eq } from "drizzle-orm"

export type AuthenticatedUser = {
  id: string
  role: "admin" | "client"
}

export type ClientAccess = {
  user: AuthenticatedUser
  clientId: string
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

export async function requireUser(): Promise<AuthenticatedUser> {
  const session = await auth()
  const user = session?.user

  if (!user?.id || (user.role !== "admin" && user.role !== "client")) {
    throw new HttpError(401, "Unauthorized")
  }

  return { id: user.id, role: user.role }
}

export async function requireAdmin(): Promise<AuthenticatedUser> {
  const user = await requireUser()
  if (user.role !== "admin") {
    throw new HttpError(403, "Forbidden")
  }
  return user
}

export async function requireClientAccess(
  requestedClientId: string | null | undefined
): Promise<ClientAccess> {
  const user = await requireUser()

  if (user.role === "admin") {
    if (!requestedClientId) {
      throw new HttpError(400, "clientId is required")
    }

    const adminClientRows = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.id, requestedClientId))
      .limit(1)
    const adminClient = adminClientRows[0]

    if (!adminClient) {
      throw new HttpError(404, "Client not found")
    }

    return { user, clientId: adminClient.id }
  }

  const clientRows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.userId, user.id))
    .limit(1)
  const client = clientRows[0]

  if (!client) {
    throw new HttpError(403, "Forbidden")
  }

  if (requestedClientId && requestedClientId !== client.id) {
    throw new HttpError(403, "Forbidden")
  }

  return { user, clientId: client.id }
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status })
  }

  console.error(error)
  return Response.json({ error: "Internal server error" }, { status: 500 })
}
