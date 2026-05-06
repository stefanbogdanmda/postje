import { auth } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import { db } from "@/db"
import { clients, users } from "@/db/schema"
import { eq } from "drizzle-orm"
import Link from "next/link"
import EditClientForm from "./edit-client-form"

interface EditClientPageProps {
  params: Promise<{ id: string }>
}

export default async function EditClientPage({
  params,
}: EditClientPageProps) {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    redirect("/login")
  }

  const { id } = await params

  const client = await db
    .select({
      id: clients.id,
      businessName: clients.businessName,
      location: clients.location,
      industry: clients.industry,
      businessType: clients.businessType,
      productsServices: clients.productsServices,
      logoUrl: clients.logoUrl,
      email: users.email,
      hasLoggedIn: users.hasLoggedIn,
    })
    .from(clients)
    .innerJoin(users, eq(clients.userId, users.id))
    .where(eq(clients.id, id))
    .get()

  if (!client) {
    notFound()
  }

  return (
    <main style={{ padding: "32px", maxWidth: "500px" }}>
      <div style={{ marginBottom: "24px" }}>
        <Link
          href="/admin/clients"
          style={{
            color: "#666",
            fontSize: "13px",
            textDecoration: "none",
          }}
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
        hasLoggedIn={client.hasLoggedIn}
      />
    </main>
  )
}
