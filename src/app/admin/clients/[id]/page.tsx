import { auth } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import { db } from "@/db"
import { clients, users } from "@/db/schema"
import { eq } from "drizzle-orm"
import Link from "next/link"
import EditClientForm from "./edit-client-form"
import MetaConnectionPanel from "@/components/admin/meta-connection-panel"
import { getConnectionByClient } from "@/lib/meta/repository"

interface EditClientPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ meta?: string; reason?: string }>
}

export default async function EditClientPage({
  params,
  searchParams,
}: EditClientPageProps) {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    redirect("/login")
  }

  const { id } = await params
  const sp = await searchParams

  const [clientRows, connection] = await Promise.all([
    db
      .select({
        id: clients.id,
        businessName: clients.businessName,
        location: clients.location,
        industry: clients.industry,
        businessType: clients.businessType,
        productsServices: clients.productsServices,
        logoUrl: clients.logoUrl,
        toneOfVoice: clients.toneOfVoice,
        targetCustomers: clients.targetCustomers,
        brandPersonality: clients.brandPersonality,
        bannedPhrases: clients.bannedPhrases,
        examplePosts: clients.examplePosts,
        postsPerWeek: clients.postsPerWeek,
        email: users.email,
        hasLoggedIn: users.hasLoggedIn,
      })
      .from(clients)
      .innerJoin(users, eq(clients.userId, users.id))
      .where(eq(clients.id, id))
      .limit(1),
    getConnectionByClient(db, id),
  ])
  const client = clientRows[0]
  if (!client) {
    notFound()
  }

  const flashKind: "connected" | "error" | null =
    sp.meta === "connected" ? "connected" : sp.meta === "error" ? "error" : null

  return (
    <main style={{ padding: "32px", maxWidth: "640px" }}>
      <div style={{ marginBottom: "24px" }}>
        <Link
          href="/admin/clients"
          style={{ color: "#666", fontSize: "13px", textDecoration: "none" }}
        >
          ← Back to clients
        </Link>
      </div>

      <EditClientForm
        clientId={client.id}
        email={client.email}
        businessName={client.businessName}
        location={client.location}
        industry={client.industry}
        businessType={client.businessType}
        productsServices={client.productsServices}
        logoUrl={client.logoUrl}
        toneOfVoice={client.toneOfVoice}
        targetCustomers={client.targetCustomers}
        brandPersonality={client.brandPersonality}
        bannedPhrases={client.bannedPhrases}
        examplePosts={client.examplePosts}
        postsPerWeek={client.postsPerWeek}
        hasLoggedIn={client.hasLoggedIn}
      />

      <MetaConnectionPanel
        clientId={client.id}
        connection={
          connection
            ? {
                pageName: connection.pageName,
                instagramBusinessId: connection.instagramBusinessId,
                connectedAt: connection.connectedAt,
              }
            : null
        }
        flashKind={flashKind}
        flashReason={sp.reason ?? null}
      />
    </main>
  )
}
