"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    // signIn("resend") triggers the magic link flow.
    // Auth.js handles token generation, hashing, and email sending.
    // The redirect: false option keeps us on this page instead of
    // navigating to a default Auth.js page.
    await signIn("resend", {
      email,
      redirect: false,
    })

    setSubmitted(true)
    setLoading(false)
  }

  if (submitted) {
    return (
      <main style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}>
        <div style={{ maxWidth: "400px", textAlign: "center" }}>
          <h1 style={{ fontSize: "24px", marginBottom: "16px" }}>
            Controleer je e-mail
          </h1>
          <p style={{ color: "#666", lineHeight: 1.6 }}>
            We hebben een inloglink gestuurd naar <strong>{email}</strong>.
            Klik op de link in de e-mail om in te loggen.
          </p>
          <p style={{ color: "#999", fontSize: "14px", marginTop: "24px" }}>
            Geen e-mail ontvangen? Controleer je spam folder of{" "}
            <button
              onClick={() => setSubmitted(false)}
              style={{
                background: "none",
                border: "none",
                color: "#1a1a1a",
                textDecoration: "underline",
                cursor: "pointer",
                fontSize: "14px",
                padding: 0,
              }}
            >
              probeer het opnieuw
            </button>
            .
          </p>
        </div>
      </main>
    )
  }

  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
    }}>
      <div style={{ maxWidth: "400px", width: "100%" }}>
        <h1 style={{ fontSize: "24px", marginBottom: "8px" }}>
          Social AI
        </h1>
        <p style={{ color: "#666", marginBottom: "32px" }}>
          Voer je e-mailadres in om in te loggen.
        </p>

        <form onSubmit={handleSubmit}>
          <label
            htmlFor="email"
            style={{
              display: "block",
              fontSize: "14px",
              fontWeight: 500,
              marginBottom: "8px",
            }}
          >
            E-mailadres
          </label>
          <input
            id="email"
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="jouw@email.nl"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              width: "100%",
              padding: "12px",
              border: "1px solid #ddd",
              borderRadius: "6px",
              fontSize: "16px",
              boxSizing: "border-box",
            }}
          />

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "12px",
              marginTop: "16px",
              backgroundColor: "#1a1a1a",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              fontSize: "16px",
              fontWeight: 500,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Bezig..." : "Inloggen"}
          </button>
        </form>
      </div>
    </main>
  )
}
