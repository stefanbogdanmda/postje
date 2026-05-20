import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { eq } from "drizzle-orm"
import { clients } from "@/db/schema"
import SignOutButton from "@/components/sign-out-button"
import Link from "next/link"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  const clientRows = await db
    .select({ businessName: clients.businessName })
    .from(clients)
    .where(eq(clients.userId, session.user.id))
    .limit(1)
  const client = clientRows[0]

  if (!client) {
    redirect("/login")
  }

  return (
    <div className="min-h-screen bg-[var(--surface-bg)]">
      <header className="bg-white border-b border-[var(--border-light)]">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase tracking-[1px] text-[var(--text-muted)]">
              POSTJE
            </span>
            <p className="font-[family-name:var(--font-display)] text-lg text-[var(--text-primary)]">
              {client.businessName}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <Link
              href="/dashboard/account"
              style={{
                fontSize: "13px",
                color: "var(--text-muted, #737373)",
                textDecoration: "none",
              }}
            >
              Account
            </Link>
            <SignOutButton label="Log uit" />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6">{children}</main>
    </div>
  )
}
