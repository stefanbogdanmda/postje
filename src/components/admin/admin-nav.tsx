import Link from "next/link"
import SignOutButton from "@/components/sign-out-button"

const links = [
  { href: "/admin", label: "Attention" },
  { href: "/admin/clients", label: "Clients" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/generate-preview", label: "Generate" },
]

export default function AdminNav() {
  return (
    <nav
      aria-label="Admin"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 32px",
        borderBottom: "1px solid var(--admin-border-strong)",
        backgroundColor: "var(--admin-surface)",
      }}
    >
      <ul style={{
        display: "flex",
        gap: "24px",
        listStyle: "none",
        margin: 0,
        padding: 0,
      }}>
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              style={{
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--admin-text)",
                textDecoration: "none",
                letterSpacing: "0.02em",
              }}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
      <SignOutButton label="Sign out" />
    </nav>
  )
}
