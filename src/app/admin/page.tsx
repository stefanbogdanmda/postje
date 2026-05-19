import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { users } from "@/db/schema"
import Link from "next/link"
import SignOutButton from "@/components/sign-out-button"
import DeleteUserButton from "./delete-user-button"

export default async function AdminPage() {
  const session = await auth()

  if (!session || session.user.role !== "admin") {
    redirect("/login")
  }

  // Fetch all users from the database
  const allUsers = await db.select().from(users)

  return (
    <main style={{ padding: "32px", maxWidth: "800px" }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "32px",
      }}>
        <h1 style={{ fontSize: "24px" }}>Admin</h1>
        <SignOutButton label="Sign out" />
      </div>

      <h2 style={{ fontSize: "18px", marginBottom: "16px" }}>Users</h2>
      <table style={{
        width: "100%",
        borderCollapse: "collapse",
      }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #eee", textAlign: "left" }}>
            <th style={{ padding: "8px" }}>Email</th>
            <th style={{ padding: "8px" }}>Role</th>
            <th style={{ padding: "8px" }}>Logged in</th>
            <th style={{ padding: "8px" }}></th>
          </tr>
        </thead>
        <tbody>
          {allUsers.map((u) => (
            <tr key={u.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "8px" }}>{u.email}</td>
              <td style={{ padding: "8px" }}>{u.role}</td>
              <td style={{ padding: "8px" }}>{u.hasLoggedIn ? "Yes" : "No"}</td>
              <td style={{ padding: "8px" }}>
                {u.role !== "admin" && (
                  <DeleteUserButton userId={u.id} userEmail={u.email} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: "32px", display: "flex", gap: "16px" }}>
        <Link
          href="/admin/attention"
          style={{
            color: "#1a1a1a",
            textDecoration: "underline",
            fontSize: "14px",
          }}
        >
          Attention dashboard →
        </Link>
        <Link
          href="/admin/clients"
          style={{
            color: "#1a1a1a",
            textDecoration: "underline",
            fontSize: "14px",
          }}
        >
          Manage clients →
        </Link>
        <Link
          href="/admin/generate-preview"
          style={{
            color: "#1a1a1a",
            textDecoration: "underline",
            fontSize: "14px",
          }}
        >
          Generate posts preview →
        </Link>
      </div>
    </main>
  )
}
