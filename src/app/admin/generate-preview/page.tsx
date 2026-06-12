import { redirect } from "next/navigation"
import { requireAdmin } from "@/lib/authorization"
import { db } from "@/db"
import { clients } from "@/db/schema"
import { asc } from "drizzle-orm"
import GeneratePreviewClient from "./generate-preview-client"

export default async function GeneratePreviewPage() {
  try {
    await requireAdmin()
  } catch {
    redirect("/login")
  }

  const clientRows = await db
    .select({ id: clients.id, businessName: clients.businessName })
    .from(clients)
    .orderBy(asc(clients.businessName))

  return <GeneratePreviewClient clients={clientRows} />
}
