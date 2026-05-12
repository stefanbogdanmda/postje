import Link from "next/link"
import type { CalibrationItem as CalibrationItemData } from "@/lib/admin/attention"

interface CalibrationItemRowProps {
  item: CalibrationItemData
  now: Date
}

function formatDaysSince(joinedAt: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - joinedAt.getTime())
  const days = Math.floor(ms / (24 * 60 * 60 * 1000))
  if (days === 0) return "vandaag"
  if (days === 1) return "1 dag geleden"
  return `${days} dagen geleden`
}

export default function CalibrationItemRow({ item, now }: CalibrationItemRowProps) {
  const href = `/admin/clients/${item.clientId}`
  return (
    <li
      style={{
        borderBottom: "1px solid var(--admin-border)",
        padding: "10px 0",
      }}
    >
      <Link
        href={href}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          alignItems: "center",
          gap: "12px",
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
            <span style={{ fontSize: "14px", fontWeight: 500 }}>
              {item.businessName}
            </span>
            <span
              className="admin-mono"
              style={{
                fontSize: "11px",
                color: "var(--admin-text-subtle)",
                letterSpacing: "0.04em",
              }}
            >
              {formatDaysSince(item.joinedAt, now)} · {item.postCount} posts
            </span>
          </div>
          <p
            style={{
              fontSize: "13px",
              color: "var(--admin-text-muted)",
              margin: "2px 0 0",
            }}
          >
            {item.postCount === 0
              ? "Nog geen posts gegenereerd — overweeg een eerste week aan te zetten."
              : "Recent gestart — kijk of de eerste lichting matcht met het merk."}
          </p>
        </div>
        <span
          className="admin-mono"
          style={{
            fontSize: "12px",
            color: "var(--admin-text-muted)",
            whiteSpace: "nowrap",
          }}
          aria-hidden="true"
        >
          →
        </span>
      </Link>
    </li>
  )
}
