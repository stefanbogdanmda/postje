import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { db } from "@/db"
import {
  findRegenLimitClients,
  findStaleApprovalPosts,
  findCalibrationClients,
  findFlaggedPosts,
  findFailedPublishes,
} from "@/lib/admin/attention-queries"

export const dynamic = "force-dynamic"

function Badge({
  count,
  severity,
}: {
  count: number
  severity: "critical" | "warn" | "info"
}) {
  const colors = {
    critical: { bg: "#fef2f2", text: "#b91c1c", border: "#fecaca" },
    warn: { bg: "#fffbeb", text: "#b45309", border: "#fed7aa" },
    info: { bg: "#f0f9ff", text: "#0369a1", border: "#bae6fd" },
  }
  const c = colors[severity]
  return (
    <span
      style={{
        fontSize: "11px",
        fontFamily: "monospace",
        padding: "1px 6px",
        borderRadius: "3px",
        backgroundColor: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
      }}
    >
      {count}
    </span>
  )
}

function SectionHeader({
  title,
  count,
  severity,
}: {
  title: string
  count: number
  severity: "critical" | "warn" | "info"
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginBottom: "8px",
      }}
    >
      <h2
        style={{
          fontSize: "14px",
          fontWeight: 600,
          margin: 0,
          color: "#1a1a1a",
        }}
      >
        {title}
      </h2>
      <Badge count={count} severity={severity} />
    </div>
  )
}

function EmptyState() {
  return (
    <p
      style={{
        fontSize: "12px",
        color: "#a3a3a3",
        fontStyle: "italic",
        margin: "4px 0 0 0",
      }}
    >
      Clear
    </p>
  )
}

function ClientLink({
  clientId,
  name,
}: {
  clientId: string
  name: string
}) {
  return (
    <Link
      href={`/admin/clients/${clientId}`}
      style={{ color: "#1a1a1a", textDecoration: "none", fontWeight: 500 }}
    >
      {name}
    </Link>
  )
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontFamily: "monospace", fontSize: "12px" }}>
      {children}
    </span>
  )
}

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "4px 8px",
  borderBottom: "1px solid #e5e5e5",
  fontSize: "11px",
  color: "#737373",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
}

const tdStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid #f5f5f5",
  color: "#1a1a1a",
}

export default async function AttentionPage() {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    redirect("/login")
  }

  const [regenLimits, stalePosts, calibration, flagged, failed] =
    await Promise.all([
      findRegenLimitClients(db),
      findStaleApprovalPosts(db),
      findCalibrationClients(db),
      findFlaggedPosts(db),
      findFailedPublishes(db),
    ])

  const totalItems =
    regenLimits.length +
    stalePosts.length +
    calibration.length +
    flagged.length +
    failed.length

  return (
    <main style={{ padding: "24px 32px", maxWidth: "1080px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
        }}
      >
        <div>
          <Link
            href="/admin"
            style={{
              color: "#737373",
              fontSize: "12px",
              textDecoration: "none",
            }}
          >
            &larr; admin
          </Link>
          <h1
            style={{
              fontSize: "18px",
              fontWeight: 600,
              margin: "4px 0 0 0",
              color: "#1a1a1a",
            }}
          >
            Attention
          </h1>
        </div>
        <div style={{ fontSize: "12px", color: "#737373" }}>
          <Mono>{totalItems}</Mono> items need attention
        </div>
      </div>

      <div
        style={{ display: "flex", flexDirection: "column", gap: "24px" }}
      >
        {/* Section 1: Failed Publishes */}
        <section>
          <SectionHeader
            title="Failed publishes"
            count={failed.length}
            severity="critical"
          />
          {failed.length === 0 ? (
            <EmptyState />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Client</th>
                  <th style={thStyle}>Platform</th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Error</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {failed.map((f) => (
                  <tr key={f.postId}>
                    <td style={tdStyle}>
                      <ClientLink
                        clientId={f.clientId}
                        name={f.businessName}
                      />
                    </td>
                    <td style={tdStyle}>
                      <Mono>
                        {f.platform === "instagram" ? "IG" : "FB"}
                      </Mono>
                    </td>
                    <td style={tdStyle}>
                      <Mono>{f.scheduledDate}</Mono>
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        color: "#b91c1c",
                        fontSize: "12px",
                        maxWidth: "300px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {f.publishError ?? "Unknown error"}
                    </td>
                    <td style={tdStyle}>
                      <Link
                        href="/admin/queue"
                        style={{ fontSize: "12px", color: "#0369a1" }}
                      >
                        Queue &rarr;
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Section 2: Flagged Posts */}
        <section>
          <SectionHeader
            title="Flagged by client"
            count={flagged.length}
            severity="critical"
          />
          {flagged.length === 0 ? (
            <EmptyState />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Client</th>
                  <th style={thStyle}>Content</th>
                  <th style={thStyle}>Reason</th>
                  <th style={thStyle}>When</th>
                </tr>
              </thead>
              <tbody>
                {flagged.map((f) => (
                  <tr key={f.flagId}>
                    <td style={tdStyle}>
                      <ClientLink
                        clientId={f.clientId}
                        name={f.businessName}
                      />
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        maxWidth: "300px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: "12px",
                      }}
                    >
                      {f.content}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        fontSize: "12px",
                        color: "#737373",
                      }}
                    >
                      {f.reason ?? "\u2014"}
                    </td>
                    <td style={tdStyle}>
                      <Mono>
                        {f.flaggedAt.toLocaleDateString("nl-NL")}
                      </Mono>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Section 3: Stale Approvals */}
        <section>
          <SectionHeader
            title="Waiting for approval (>24h)"
            count={stalePosts.length}
            severity="warn"
          />
          {stalePosts.length === 0 ? (
            <EmptyState />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Client</th>
                  <th style={thStyle}>Platform</th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Waiting</th>
                </tr>
              </thead>
              <tbody>
                {stalePosts.map((s) => (
                  <tr key={s.postId}>
                    <td style={tdStyle}>
                      <ClientLink
                        clientId={s.clientId}
                        name={s.businessName}
                      />
                    </td>
                    <td style={tdStyle}>
                      <Mono>
                        {s.platform === "instagram" ? "IG" : "FB"}
                      </Mono>
                    </td>
                    <td style={tdStyle}>
                      <Mono>{s.scheduledDate}</Mono>
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        color:
                          s.hoursWaiting > 48 ? "#b91c1c" : "#b45309",
                      }}
                    >
                      <Mono>{s.hoursWaiting}h</Mono>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Section 4: Rejection Limits */}
        <section>
          <SectionHeader
            title="Rejection limit hit"
            count={regenLimits.length}
            severity="warn"
          />
          {regenLimits.length === 0 ? (
            <EmptyState />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Client</th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Rejections</th>
                </tr>
              </thead>
              <tbody>
                {regenLimits.map((r) => (
                  <tr key={r.postId}>
                    <td style={tdStyle}>
                      <ClientLink
                        clientId={r.clientId}
                        name={r.businessName}
                      />
                    </td>
                    <td style={tdStyle}>
                      <Mono>{r.scheduledDate}</Mono>
                    </td>
                    <td style={tdStyle}>
                      <Mono>{r.rejectionCount}x</Mono>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Section 5: Calibration Clients */}
        <section>
          <SectionHeader
            title="In calibration"
            count={calibration.length}
            severity="info"
          />
          {calibration.length === 0 ? (
            <EmptyState />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Client</th>
                  <th style={thStyle}>Day</th>
                  <th style={thStyle}>Pending</th>
                </tr>
              </thead>
              <tbody>
                {calibration.map((c) => (
                  <tr key={c.clientId}>
                    <td style={tdStyle}>
                      <ClientLink
                        clientId={c.clientId}
                        name={c.businessName}
                      />
                    </td>
                    <td style={tdStyle}>
                      <Mono>{c.daysInCalibration}/14</Mono>
                    </td>
                    <td style={tdStyle}>
                      <Mono>{c.pendingPostCount} posts</Mono>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  )
}
