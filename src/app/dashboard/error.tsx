"use client"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div style={{ padding: "24px", maxWidth: "600px" }}>
      <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>
        Er ging iets mis
      </h2>
      <p style={{ fontSize: "14px", color: "#737373", marginBottom: "16px" }}>
        Er is een fout opgetreden bij het laden van je dashboard. Probeer het
        opnieuw of neem contact op als het probleem aanhoudt.
      </p>
      <button
        onClick={reset}
        style={{
          padding: "8px 16px",
          fontSize: "14px",
          borderRadius: "6px",
          border: "1px solid #d4d4d4",
          backgroundColor: "#ffffff",
          cursor: "pointer",
        }}
      >
        Opnieuw proberen
      </button>
    </div>
  )
}
