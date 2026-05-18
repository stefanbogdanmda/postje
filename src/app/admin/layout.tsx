import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import AdminNav from "@/components/admin/admin-nav"
import "@/styles/admin-tokens.css"

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    redirect("/login")
  }

  return (
    <div className="admin-shell" style={{ minHeight: "100vh" }}>
      <AdminNav />
      {children}
    </div>
  )
}
