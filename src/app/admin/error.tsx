"use client"

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div style={{ padding: "32px" }}>
      <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>
        Admin error
      </h2>
      <p style={{ fontSize: "14px", color: "#737373", marginBottom: "8px" }}>
        Something went wrong loading this page.
      </p>
      <pre
        style={{
          fontSize: "12px",
          color: "#b91c1c",
          backgroundColor: "#fef2f2",
          padding: "8px 12px",
          borderRadius: "4px",
          marginBottom: "16px",
          overflow: "auto",
        }}
      >
        {error.message}
      </pre>
      <button
        onClick={reset}
        style={{
          padding: "6px 12px",
          fontSize: "13px",
          borderRadius: "4px",
          border: "1px solid #d4d4d4",
          backgroundColor: "#ffffff",
          cursor: "pointer",
        }}
      >
        Retry
      </button>
    </div>
  )
}
