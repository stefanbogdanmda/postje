import { db } from "@/db"
import { users } from "@/db/schema"
import DeleteUserButton from "../delete-user-button"

export default async function AdminUsersPage() {
  // Auth + role gate handled by /admin/layout.tsx.
  const allUsers = await db.select().from(users)

  return (
    <main style={{ padding: "32px", maxWidth: "800px" }}>
      <h1 style={{ fontSize: "20px", marginBottom: "24px", letterSpacing: "0.02em" }}>
        Users
      </h1>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--admin-border-strong)", textAlign: "left" }}>
            <th style={{ padding: "8px", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Email</th>
            <th style={{ padding: "8px", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Role</th>
            <th style={{ padding: "8px", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Logged in</th>
            <th style={{ padding: "8px" }}></th>
          </tr>
        </thead>
        <tbody>
          {allUsers.map((u) => (
            <tr key={u.id} style={{ borderBottom: "1px solid var(--admin-border)" }}>
              <td style={{ padding: "8px", fontSize: "13px" }}>{u.email}</td>
              <td style={{ padding: "8px", fontSize: "13px" }}>{u.role}</td>
              <td style={{ padding: "8px", fontSize: "13px" }}>{u.hasLoggedIn ? "Yes" : "No"}</td>
              <td style={{ padding: "8px" }}>
                {u.role !== "admin" && (
                  <DeleteUserButton userId={u.id} userEmail={u.email} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
