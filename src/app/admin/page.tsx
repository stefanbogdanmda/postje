import { db } from "@/db"
import { getAttentionData } from "@/lib/admin/attention"
import AttentionSection from "@/components/admin/attention-section"
import AttentionItemRow from "@/components/admin/attention-item"
import CalibrationItemRow from "@/components/admin/calibration-item"

export default async function AdminAttentionPage() {
  // Auth + role gate handled by /admin/layout.tsx.
  const now = new Date()
  const data = await getAttentionData(db, now)

  return (
    <main
      style={{
        padding: "32px",
        maxWidth: "960px",
        margin: "0 auto",
      }}
    >
      <header style={{ marginBottom: "12px" }}>
        <h1 style={{ fontSize: "20px", margin: 0, letterSpacing: "0.02em" }}>
          Attention
        </h1>
        <p
          style={{
            fontSize: "13px",
            color: "var(--admin-text-subtle)",
            margin: "4px 0 0",
          }}
        >
          Wat vraagt nu om je aandacht, over alle klanten heen.
        </p>
      </header>

      <AttentionSection
        title="Failed to publish"
        count={data.failedPosts.length}
        severity="critical"
        emptyMessage="Geen publish-fouten."
      >
        {data.failedPosts.map((item) => (
          <AttentionItemRow key={item.postId} item={item} now={now} />
        ))}
      </AttentionSection>

      <AttentionSection
        title="Overdue"
        count={data.overduePosts.length}
        severity="critical"
        emptyMessage="Niets achterstallig."
      >
        {data.overduePosts.map((item) => (
          <AttentionItemRow key={item.postId} item={item} now={now} />
        ))}
      </AttentionSection>

      <AttentionSection
        title="Stale drafts"
        count={data.staleDrafts.length}
        severity="warn"
        emptyMessage="Geen drafts die te lang stilliggen."
      >
        {data.staleDrafts.map((item) => (
          <AttentionItemRow key={item.postId} item={item} now={now} />
        ))}
      </AttentionSection>

      <AttentionSection
        title="Regen limit hit"
        count={data.regenLimitHits.length}
        severity="warn"
        emptyMessage="Geen klanten vastgelopen op de regen-limit."
      >
        {data.regenLimitHits.map((item) => (
          <AttentionItemRow key={item.postId} item={item} now={now} />
        ))}
      </AttentionSection>

      <AttentionSection
        title="Unseen drafts"
        count={data.unseenDrafts.length}
        severity="info"
        emptyMessage="Iedereen heeft z'n drafts gezien."
      >
        {data.unseenDrafts.map((item) => (
          <AttentionItemRow key={item.postId} item={item} now={now} />
        ))}
      </AttentionSection>

      <AttentionSection
        title="Recent rejections"
        count={data.recentRejections.length}
        severity="info"
        emptyMessage="Geen afwijzingen de afgelopen 7 dagen."
      >
        {data.recentRejections.map((item) => (
          <AttentionItemRow key={item.postId} item={item} now={now} />
        ))}
      </AttentionSection>

      <AttentionSection
        title="Calibration"
        count={data.calibrationClients.length}
        severity="soft"
        emptyMessage="Geen nieuwe klanten in calibratie."
      >
        {data.calibrationClients.map((item) => (
          <CalibrationItemRow key={item.clientId} item={item} now={now} />
        ))}
      </AttentionSection>
    </main>
  )
}
