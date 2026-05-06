"use client"

import { useState } from "react"
import type { GenerationResult } from "@/lib/ai/types"

export default function GeneratePreviewPage() {
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch("/api/generate-posts", { method: "POST" })
      const data = await response.json()

      if (!response.ok) {
        setError(data.error || "Generation failed")
        return
      }

      setResult(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ maxWidth: "800px", padding: "32px" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "8px" }}>
        Post Generation Preview
      </h1>
      <p style={{ color: "#666", marginBottom: "24px" }}>
        Generate a week of posts for Café de Hoek. Takes ~15–30 seconds (two AI
        calls).
      </p>

      <button
        onClick={handleGenerate}
        disabled={loading}
        style={{
          padding: "8px 16px",
          backgroundColor: loading ? "#999" : "#1a1a1a",
          color: "#fff",
          border: "none",
          borderRadius: "4px",
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Generating…" : "Generate Week"}
      </button>

      {error && (
        <div
          style={{
            marginTop: "24px",
            padding: "16px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "4px",
            color: "#991b1b",
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: "32px" }}>
          {/* Metadata */}
          <p style={{ fontSize: "12px", color: "#888", marginBottom: "24px" }}>
            Generated at{" "}
            {new Date(result.metadata.generatedAt).toLocaleString()} · Model:{" "}
            {result.metadata.model} · Tokens:{" "}
            {result.metadata.planInputTokens +
              result.metadata.planOutputTokens +
              result.metadata.postsInputTokens +
              result.metadata.postsOutputTokens}{" "}
            total
          </p>

          {/* Posts by day */}
          {result.posts.map((post) => {
            const dayPlan = result.plan.find((p) => p.day === post.day)
            return (
              <div
                key={post.day}
                style={{
                  border: "1px solid #eee",
                  borderRadius: "8px",
                  padding: "24px",
                  marginBottom: "24px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    marginBottom: "16px",
                  }}
                >
                  <h2 style={{ fontSize: "18px", fontWeight: 600 }}>
                    {post.day}
                  </h2>
                  {dayPlan && (
                    <span style={{ fontSize: "12px", color: "#888" }}>
                      {dayPlan.theme} · {dayPlan.angle}
                    </span>
                  )}
                </div>

                {/* Instagram */}
                <div style={{ marginBottom: "12px" }}>
                  <h3
                    style={{
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "#be185d",
                      marginBottom: "4px",
                    }}
                  >
                    Instagram
                  </h3>
                  <p
                    style={{
                      whiteSpace: "pre-wrap",
                      backgroundColor: "#f9fafb",
                      padding: "12px",
                      borderRadius: "4px",
                      fontSize: "14px",
                    }}
                  >
                    {post.instagramCaption}
                  </p>
                </div>

                {/* Facebook */}
                <div style={{ marginBottom: "12px" }}>
                  <h3
                    style={{
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "#1d4ed8",
                      marginBottom: "4px",
                    }}
                  >
                    Facebook
                  </h3>
                  <p
                    style={{
                      whiteSpace: "pre-wrap",
                      backgroundColor: "#f9fafb",
                      padding: "12px",
                      borderRadius: "4px",
                      fontSize: "14px",
                    }}
                  >
                    {post.facebookPost}
                  </p>
                </div>

                {/* Warnings */}
                {post.warnings.length > 0 && (
                  <div
                    style={{
                      backgroundColor: "#fffbeb",
                      border: "1px solid #fde68a",
                      borderRadius: "4px",
                      padding: "12px",
                      marginBottom: "12px",
                    }}
                  >
                    <strong style={{ fontSize: "12px", color: "#92400e" }}>
                      Warnings:
                    </strong>
                    <ul style={{ margin: "4px 0 0 16px", fontSize: "12px", color: "#92400e" }}>
                      {post.warnings.map((w, i) => (
                        <li key={i}>
                          [{w.platform}] {w.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Reasoning + Summary */}
                <div
                  style={{
                    borderTop: "1px solid #eee",
                    paddingTop: "12px",
                    fontSize: "13px",
                    color: "#666",
                  }}
                >
                  <p style={{ marginBottom: "4px" }}>
                    <strong>Why:</strong> {post.reasoning}
                  </p>
                  <p>
                    <strong>EN:</strong> {post.englishSummary}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
