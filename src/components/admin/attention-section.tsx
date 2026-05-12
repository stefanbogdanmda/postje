import type { ReactNode } from "react"

interface AttentionSectionProps {
  title: string
  count: number
  severity: "critical" | "warn" | "info" | "soft"
  emptyMessage: string
  children: ReactNode
}

const severityColor: Record<AttentionSectionProps["severity"], string> = {
  critical: "var(--admin-sev-critical)",
  warn: "var(--admin-sev-warn)",
  info: "var(--admin-sev-info)",
  soft: "var(--admin-sev-soft)",
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

export default function AttentionSection({
  title,
  count,
  severity,
  emptyMessage,
  children,
}: AttentionSectionProps) {
  const headingId = `section-${slug(title)}`
  return (
    <section
      aria-labelledby={headingId}
      style={{
        borderTop: "1px solid var(--admin-border)",
        padding: "16px 0",
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", gap: "12px", marginBottom: "8px" }}>
        <h2
          id={headingId}
          style={{
            fontSize: "13px",
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--admin-text)",
            margin: 0,
          }}
        >
          {title}
        </h2>
        <span
          className="admin-mono"
          style={{
            fontSize: "12px",
            color: count === 0 ? "var(--admin-text-subtle)" : severityColor[severity],
            fontWeight: 500,
          }}
        >
          [{count}]
        </span>
      </header>

      {count === 0 ? (
        <p
          style={{
            fontSize: "13px",
            color: "var(--admin-text-subtle)",
            margin: 0,
          }}
        >
          {emptyMessage}
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {children}
        </ul>
      )}
    </section>
  )
}
