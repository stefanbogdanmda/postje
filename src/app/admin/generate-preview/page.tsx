import { redirect } from "next/navigation"
import { requireAdmin } from "@/lib/authorization"
import { CAFE_DE_HOEK_CLIENT_ID } from "@/data/clients/cafe-de-hoek"
import GeneratePreviewClient from "./generate-preview-client"

export default async function GeneratePreviewPage() {
  try {
    await requireAdmin()
  } catch {
    redirect("/login")
  }

  return <GeneratePreviewClient clientId={CAFE_DE_HOEK_CLIENT_ID} />
}
