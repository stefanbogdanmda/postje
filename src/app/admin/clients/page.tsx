import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { clients, users } from "@/db/schema"
import { eq } from "drizzle-orm"
import Link from "next/link"
import SuccessBanner from "@/components/success-banner"

interface ClientListPageProps {
  searchParams: Promise<{ success?: string }>
}

export default async function ClientListPage({
  searchParams,
}: ClientListPageProps) {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    redirect("/login")
  }

  const params = await searchParams
  const successMessage = params.success

  // Join clients with users to get email and hasLoggedIn status
  const allClients = await db
    .select({
      id: clients.id,
      businessName: clients.businessName,
      location: clients.location,
      industry: clients.industry,
      email: users.email,
      hasLoggedIn: users.hasLoggedIn,
    })
    .from(clients)
    .innerJoin(users, eq(clients.userId, users.id))
    .all()

  return (
    <main style={{ padding: "32px", maxWidth: "800px" }}>
      <div style={{ marginBottom: "24px" }}>
        <Link
          href="/admin"
          style={{
            color: "#666",
            fontSize: "13px",
            textDecoration: "none",
          }}
        >
          ← Back to admin
        </Link>
      </div>

      {successMessage && <SuccessBanner message={successMessage} />}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
        }}
      >
        <h1 style={{ fontSize: "24px" }}>Clients</h1>
        <Link
          href="/admin/clients/new"
          style={{
            backgroundColor: "#1a1a1a",
            color: "#fff",
            padding: "8px 16px",
            borderRadius: "6px",
            fontSize: "14px",
            textDecoration: "none",
            fontWeight: 500,
          }}
        >
          + New Client
        </Link>
      </div>

      {allClients.length === 0 ? (
        <div style={{ color: "#666", textAlign: "center", padding: "48px 0" }}>
          <p style={{ marginBottom: "8px" }}>No clients yet.</p>
          <Link
            href="/admin/clients/new"
            style={{ color: "#1a1a1a", textDecoration: "underline" }}
          >
            Create your first client
          </Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {allClients.map((client) => (
            <div
              key={client.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: "8px",
                padding: "16px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: "15px" }}>
                  {client.businessName}
                </div>
                <div
                  style={{ color: "#666", fontSize: "13px", marginTop: "2px" }}
                >
                  {[client.email, client.industry, client.location]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div
                style={{ display: "flex", alignItems: "center", gap: "12px" }}
              >
                <span
                  style={{
                    color: client.hasLoggedIn ? "#16a34a" : "#ca8a04",
                    fontSize: "13px",
                  }}
                >
                  {client.hasLoggedIn ? "Active" : "Invited"}
                </span>
                <Link
                  href={`/admin/clients/${client.id}`}
                  style={{
                    color: "#1a1a1a",
                    textDecoration: "underline",
                    fontSize: "13px",
                  }}
                >
                  Edit
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
