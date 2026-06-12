"use client"

import { useState } from "react"
import Link from "next/link"
import { createClient } from "../actions"

export default function NewClientPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = await createClient(formData)

    // If we get here (no redirect), there was an error
    if (result?.error) {
      setError(result.error)
    }
    setLoading(false)
  }

  const labelStyle = {
    display: "block" as const,
    fontSize: "13px",
    fontWeight: 500,
    marginBottom: "6px",
    color: "#333",
  }

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #ddd",
    borderRadius: "6px",
    fontSize: "15px",
    boxSizing: "border-box" as const,
  }

  const textareaStyle = {
    ...inputStyle,
    minHeight: "80px",
    resize: "vertical" as const,
    fontFamily: "inherit",
  }

  const hintStyle = {
    color: "#999",
    fontSize: "12px",
    marginTop: "4px",
    marginBottom: 0,
  }

  return (
    <main
      style={{
        padding: "32px",
        maxWidth: "500px",
      }}
    >
      <div style={{ marginBottom: "24px" }}>
        <Link
          href="/admin/clients"
          style={{
            color: "#666",
            fontSize: "13px",
            textDecoration: "none",
          }}
        >
          ← Back to clients
        </Link>
      </div>

      <h1 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "24px" }}>
        New Client
      </h1>

      {error && (
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "6px",
            marginBottom: "20px",
            fontSize: "14px",
            color: "#991b1b",
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="email" style={labelStyle}>
            Email *
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="client@example.nl"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="businessName" style={labelStyle}>
            Business Name *
          </label>
          <input
            id="businessName"
            name="businessName"
            type="text"
            required
            placeholder="Café De Hoek"
            style={inputStyle}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "16px",
            marginBottom: "20px",
          }}
        >
          <div>
            <label htmlFor="location" style={labelStyle}>
              Location
            </label>
            <input
              id="location"
              name="location"
              type="text"
              placeholder="Amsterdam"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="industry" style={labelStyle}>
              Industry
            </label>
            <input
              id="industry"
              name="industry"
              type="text"
              placeholder="Hospitality"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="businessType" style={labelStyle}>
            Business Type
          </label>
          <input
            id="businessType"
            name="businessType"
            type="text"
            placeholder="Restaurant"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="productsServices" style={labelStyle}>
            Products / Services
          </label>
          <textarea
            id="productsServices"
            name="productsServices"
            placeholder="Describe what this business offers..."
            style={{
              ...inputStyle,
              minHeight: "80px",
              resize: "vertical" as const,
              fontFamily: "inherit",
            }}
          />
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="postsPerWeek" style={labelStyle}>
            Posts per week
          </label>
          <input
            id="postsPerWeek"
            name="postsPerWeek"
            type="number"
            min={3}
            max={6}
            defaultValue={5}
            style={inputStyle}
          />
          <p style={hintStyle}>
            How many days per week to post (3–6). One post per platform each day.
          </p>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="logoUrl" style={labelStyle}>
            Logo URL
          </label>
          <input
            id="logoUrl"
            name="logoUrl"
            type="url"
            placeholder="https://..."
            style={inputStyle}
          />
        </div>

        <div
          style={{
            borderTop: "1px solid #eee",
            marginBottom: "28px",
            paddingTop: "20px",
          }}
        >
          <h2 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 4px" }}>
            Brand voice
          </h2>
          <p style={{ color: "#666", fontSize: "12px", margin: "0 0 20px" }}>
            These shape how the AI writes for this client. Leave any field blank
            to fall back to sensible defaults.
          </p>

          <div style={{ marginBottom: "20px" }}>
            <label htmlFor="toneOfVoice" style={labelStyle}>
              Tone of voice
            </label>
            <textarea
              id="toneOfVoice"
              name="toneOfVoice"
              placeholder="Warm, direct, local. No corporate marketing language."
              style={textareaStyle}
            />
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label htmlFor="targetCustomers" style={labelStyle}>
              Target customers
            </label>
            <textarea
              id="targetCustomers"
              name="targetCustomers"
              placeholder="Who are the customers? One per line or comma-separated."
              style={textareaStyle}
            />
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label htmlFor="brandPersonality" style={labelStyle}>
              Brand personality
            </label>
            <textarea
              id="brandPersonality"
              name="brandPersonality"
              placeholder="How does the owner come across? e.g. friendly, no-nonsense, playful."
              style={textareaStyle}
            />
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label htmlFor="bannedPhrases" style={labelStyle}>
              Banned phrases
            </label>
            <textarea
              id="bannedPhrases"
              name="bannedPhrases"
              placeholder={"One phrase per line\nculinair\ngeniet van"}
              style={textareaStyle}
            />
            <p style={hintStyle}>
              One phrase per line. The AI will never use these.
            </p>
          </div>

          <div style={{ marginBottom: 0 }}>
            <label htmlFor="examplePosts" style={labelStyle}>
              Example posts
            </label>
            <textarea
              id="examplePosts"
              name="examplePosts"
              placeholder="Real posts written in the business's own voice. Separate each one with a blank line."
              style={{ ...textareaStyle, minHeight: "120px" }}
            />
            <p style={hintStyle}>
              Separate each example with a blank line. The AI imitates these.
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "12px 24px",
            backgroundColor: "#1a1a1a",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            fontSize: "15px",
            fontWeight: 500,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Creating..." : "Create Client & Send Invite"}
        </button>
        <p
          style={{
            color: "#666",
            fontSize: "12px",
            marginTop: "8px",
            textAlign: "center",
          }}
        >
          Creates the account and sends a welcome email with a magic link.
        </p>
      </form>
    </main>
  )
}
