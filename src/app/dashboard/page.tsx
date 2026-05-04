import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import SignOutButton from "@/components/sign-out-button"

export default async function DashboardPage() {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  return (
    <main style={{ padding: "32px", maxWidth: "600px" }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "32px",
      }}>
        <h1 style={{ fontSize: "24px" }}>Dashboard</h1>
        <SignOutButton label="Log uit" />
      </div>
      <p style={{ color: "#666" }}>
        Je dashboard wordt binnenkort beschikbaar.
      </p>
    </main>
  )
}
