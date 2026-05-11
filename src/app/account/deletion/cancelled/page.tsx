import Link from "next/link"

export default function DeletionCancelledPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        fontFamily: "sans-serif",
        color: "#1a1a1a",
      }}
    >
      <div style={{ maxWidth: "32rem", textAlign: "center" }}>
        <h1 style={{ margin: "0 0 1rem", fontSize: "1.75rem" }}>
          Geen verwijdering nodig
        </h1>
        <p style={{ margin: "0 0 1.5rem", lineHeight: 1.6 }}>
          We hebben je verzoek geannuleerd. Je account blijft gewoon bestaan
          &mdash; je hoeft verder niets te doen.
        </p>
        <p style={{ margin: 0 }}>
          <Link
            href="/dashboard"
            style={{
              display: "inline-block",
              padding: "0.625rem 1rem",
              background: "#1a1a1a",
              color: "#fff",
              textDecoration: "none",
              borderRadius: "0.375rem",
            }}
          >
            Terug naar je dashboard
          </Link>
        </p>
      </div>
    </main>
  )
}
