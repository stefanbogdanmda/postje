import Link from "next/link"
import type { AttentionItem as AttentionItemData } from "@/lib/admin/attention"

interface AttentionItemRowProps {
  item: AttentionItemData
  now: Date
}

const platformLabel: Record<"instagram" | "facebook", string> = {
  instagram: "IG",
  facebook: "FB",
}

/** Compact age expressed in the largest unit that fits: 12m, 3h, 2d. */
function formatAge(signalAt: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - signalAt.getTime())
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export default function AttentionItemRow({ item, now }: AttentionItemRowProps) {
  const href = `/admin/clients/${item.clientId}`
  const age = formatAge(item.signalAt, now)
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
              {platformLabel[item.platform]} · {item.scheduledDate}
            </span>
          </div>
          <p
            style={{
              fontSize: "13px",
              color: "var(--admin-text-muted)",
              margin: "2px 0 0",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.contentPreview}
          </p>
        </div>
        <span
          className="admin-mono"
          style={{
            fontSize: "12px",
            color: "var(--admin-text-muted)",
            whiteSpace: "nowrap",
          }}
          aria-label={`Signal age ${age}`}
        >
          {age} →
        </span>
      </Link>
    </li>
  )
}
