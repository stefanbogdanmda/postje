import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/db"
import { getQueueItems, type QueueItem } from "@/lib/admin/queue"
import { PublishButton } from "@/components/admin/publish-button"

export const dynamic = "force-dynamic"

export default async function QueuePage() {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    redirect("/login")
  }

  const items = await getQueueItems(db)

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>
        Publicatie-wachtrij ({items.length})
      </h1>

      {items.length === 0 ? (
        <p style={{ color: "#888" }}>Geen goedgekeurde posts wachten op publicatie.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
          {items.map((item) => (
            <QueueRow key={item.postId} item={item} />
          ))}
        </ul>
      )}
    </main>
  )
}

function QueueRow({ item }: { item: QueueItem }) {
  const platformLabel = item.platform === "instagram" ? "IG" : "FB"
  const scheduled = item.publishAt
    ? formatRelative(item.publishAt)
    : item.scheduledDate

  return (
    <li
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: 4,
        padding: 12,
        display: "grid",
        gridTemplateColumns: "64px 1fr auto",
        gap: 12,
        alignItems: "center",
      }}
    >
      <div>
        {item.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.photoUrl}
            alt=""
            width={64}
            height={64}
            style={{ objectFit: "cover", borderRadius: 4, width: 64, height: 64 }}
          />
        ) : (
          <div
            style={{
              width: 64,
              height: 64,
              background: "#f3f3f3",
              borderRadius: 4,
              display: "grid",
              placeItems: "center",
              color: "#888",
              fontSize: 11,
            }}
          >
            geen foto
          </div>
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {item.businessName}{" "}
          <span style={{ fontSize: 11, color: "#888", fontWeight: 400 }}>
            {platformLabel} · {scheduled}
          </span>
        </div>
        <div
          style={{
            fontSize: 13,
            color: "#333",
            marginTop: 4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {item.content}
        </div>
      </div>
      <PublishButton
        postId={item.postId}
        disabled={!item.hasMetaConnection}
        disabledReason={item.hasMetaConnection ? undefined : "Client is niet verbonden met Meta"}
      />
    </li>
  )
}

function formatRelative(when: Date): string {
  const now = Date.now()
  const diffMs = when.getTime() - now
  const diffMin = Math.round(diffMs / 60_000)
  if (Math.abs(diffMin) < 60) return diffMin >= 0 ? `over ${diffMin}m` : `${-diffMin}m geleden`
  const diffHr = Math.round(diffMin / 60)
  if (Math.abs(diffHr) < 48) return diffHr >= 0 ? `over ${diffHr}u` : `${-diffHr}u geleden`
  return when.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })
}
