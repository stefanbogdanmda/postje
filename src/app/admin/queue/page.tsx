import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { db } from "@/db"
import { findQueuePosts } from "@/lib/posts/queue-repository"
import PublishButton from "@/components/admin/publish-button"

export const dynamic = "force-dynamic"

function platformBadge(platform: "instagram" | "facebook") {
  const label = platform === "instagram" ? "IG" : "FB"
  return (
    <span
      style={{
        fontSize: "11px",
        padding: "1px 6px",
        borderRadius: "3px",
        border: "1px solid var(--admin-border, #e5e5e5)",
        color: "var(--admin-text-muted, #525252)",
      }}
    >
      {label}
    </span>
  )
}

function statusPill(status: "approved" | "failed") {
  const isFailed = status === "failed"
  return (
    <span
      style={{
        fontSize: "11px",
        padding: "1px 8px",
        borderRadius: "999px",
        color: isFailed
          ? "var(--admin-sev-critical, #b91c1c)"
          : "var(--admin-text-muted, #525252)",
        border: `1px solid ${
          isFailed
            ? "var(--admin-sev-critical, #b91c1c)"
            : "var(--admin-border, #e5e5e5)"
        }`,
      }}
    >
      {status === "failed" ? "Failed" : "Approved"}
    </span>
  )
}

export default async function QueuePage() {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    redirect("/login")
  }

  const queue = await findQueuePosts(db)

  return (
    <main style={{ padding: "32px", maxWidth: "960px" }}>
      <div style={{ marginBottom: "24px" }}>
        <Link
          href="/admin"
          style={{ color: "#666", fontSize: "13px", textDecoration: "none" }}
        >
          ← Back to admin
        </Link>
      </div>
      <h1
        style={{
          fontSize: "20px",
          fontWeight: 600,
          margin: 0,
          marginBottom: "8px",
          color: "var(--admin-text, #1a1a1a)",
        }}
      >
        Publish queue
      </h1>
      <p
        style={{
          fontSize: "13px",
          color: "var(--admin-text-muted, #525252)",
          margin: 0,
          marginBottom: "24px",
        }}
      >
        Approved posts ready to publish, plus posts that failed and need a
        retry. {queue.length} item{queue.length === 1 ? "" : "s"}.
      </p>

      {queue.length === 0 ? (
        <p
          style={{
            padding: "32px",
            border: "1px dashed var(--admin-border, #e5e5e5)",
            borderRadius: "6px",
            textAlign: "center",
            color: "var(--admin-text-subtle, #737373)",
          }}
        >
          Niets te publiceren. Goed bezig.
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {queue.map((post) => {
            const igNoPhoto =
              post.platform === "instagram" && post.photoUrl === null
            const noConnection = !post.hasMetaConnection
            const disabled = igNoPhoto || noConnection
            const disabledReason = noConnection
              ? "Klant heeft geen Meta-koppeling."
              : igNoPhoto
              ? "Instagram vereist een foto."
              : null

            return (
              <li
                key={post.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: "16px",
                  alignItems: "start",
                  padding: "16px 20px",
                  border: "1px solid var(--admin-border, #e5e5e5)",
                  borderRadius: "6px",
                  backgroundColor: "var(--admin-surface, #ffffff)",
                }}
              >
                <div
                  style={{
                    width: "56px",
                    height: "56px",
                    backgroundColor: "var(--admin-bg, #fafafa)",
                    border: "1px solid var(--admin-border, #e5e5e5)",
                    borderRadius: "4px",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--admin-text-subtle, #737373)",
                    fontSize: "11px",
                  }}
                >
                  {post.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.photoUrl}
                      alt=""
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    "geen foto"
                  )}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                      marginBottom: "4px",
                    }}
                  >
                    <Link
                      href={`/admin/clients/${post.clientId}`}
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "var(--admin-text, #1a1a1a)",
                        textDecoration: "none",
                      }}
                    >
                      {post.businessName}
                    </Link>
                    {platformBadge(post.platform)}
                    {statusPill(post.status)}
                    <span
                      style={{
                        fontSize: "12px",
                        color: "var(--admin-text-subtle, #737373)",
                      }}
                    >
                      {post.scheduledDate}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: "13px",
                      color: "var(--admin-text-muted, #525252)",
                      margin: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {post.content}
                  </p>
                  {post.publishError && (
                    <p
                      style={{
                        fontSize: "12px",
                        color: "var(--admin-sev-critical, #b91c1c)",
                        margin: "6px 0 0 0",
                      }}
                    >
                      {post.publishError}
                    </p>
                  )}
                </div>

                <PublishButton
                  postId={post.id}
                  mode={post.status === "failed" ? "retry" : "publish"}
                  disabled={disabled}
                  disabledReason={disabledReason}
                />
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
