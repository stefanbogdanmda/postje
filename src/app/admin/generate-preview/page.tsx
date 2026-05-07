"use client"

import { useState } from "react"
import type { GenerationResult, PhotoAnalysis } from "@/lib/ai/types"

function PhotoAnalysisPanel({ analysis }: { analysis: PhotoAnalysis }) {
  const [open, setOpen] = useState(false)

  return (
    <div
      style={{
        borderTop: "1px solid #eee",
        paddingTop: "12px",
        marginTop: "12px",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: "12px",
          color: "#888",
          padding: 0,
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        <span style={{ fontSize: "10px" }}>{open ? "▼" : "▶"}</span>
        What Claude saw in this photo
      </button>
      {open && (
        <div
          style={{
            marginTop: "8px",
            fontSize: "12px",
            color: "#666",
            backgroundColor: "#f9fafb",
            padding: "12px",
            borderRadius: "4px",
          }}
        >
          <p style={{ marginBottom: "6px" }}>
            <strong>Subjects:</strong> {analysis.subjects.join(", ")}
          </p>
          <p style={{ marginBottom: "6px" }}>
            <strong>Mood:</strong> {analysis.mood}
          </p>
          {analysis.season && (
            <p style={{ marginBottom: "6px" }}>
              <strong>Season:</strong> {analysis.season}
            </p>
          )}
          <p style={{ marginBottom: "6px" }}>
            <strong>Setting:</strong> {analysis.setting}
          </p>
          <p style={{ marginBottom: "6px" }}>
            <strong>Brand angles:</strong>{" "}
            {analysis.brandAngles.join(", ")}
          </p>
          <p>
            <strong>Details:</strong> {analysis.visualDetails}
          </p>
        </div>
      )}
    </div>
  )
}

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
            total · Photos: {result.metadata.photosUsed}
          </p>

          {/* Posts by day */}
          {result.posts.map((post) => {
            const dayPlan = result.plan.find((p) => p.day === post.day)
            const isPhotoDay = post.photoId !== null && post.photoUrl !== null
            const photoAnalysis =
              post.photoId && result.photoAnalyses[post.photoId]
                ? result.photoAnalyses[post.photoId]
                : null

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
                  <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                    <h2 style={{ fontSize: "18px", fontWeight: 600 }}>
                      {post.day}
                    </h2>
                    {isPhotoDay && (
                      <span
                        style={{
                          fontSize: "11px",
                          backgroundColor: "#dbeafe",
                          color: "#1d4ed8",
                          padding: "2px 8px",
                          borderRadius: "9999px",
                        }}
                      >
                        Photo post
                      </span>
                    )}
                  </div>
                  {dayPlan && (
                    <span style={{ fontSize: "12px", color: "#888" }}>
                      {dayPlan.theme} · {dayPlan.angle}
                    </span>
                  )}
                </div>

                {isPhotoDay ? (
                  /* Photo day: side-by-side platform previews */
                  <div style={{ display: "flex", gap: "16px", marginBottom: "12px" }}>
                    {/* Instagram preview */}
                    <div style={{ flex: 1, borderRadius: "8px", overflow: "hidden", border: "1px solid #eee" }}>
                      <img
                        src={post.photoUrl!}
                        alt={`Photo for ${post.day}`}
                        style={{ width: "100%", height: "200px", objectFit: "cover", display: "block" }}
                      />
                      <div style={{ padding: "12px" }}>
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
                        <p style={{ whiteSpace: "pre-wrap", fontSize: "14px" }}>
                          {post.instagramCaption}
                        </p>
                      </div>
                    </div>

                    {/* Facebook preview */}
                    <div style={{ flex: 1, borderRadius: "8px", overflow: "hidden", border: "1px solid #eee" }}>
                      <img
                        src={post.photoUrl!}
                        alt={`Photo for ${post.day}`}
                        style={{ width: "100%", height: "200px", objectFit: "cover", display: "block" }}
                      />
                      <div style={{ padding: "12px" }}>
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
                        <p style={{ whiteSpace: "pre-wrap", fontSize: "14px" }}>
                          {post.facebookPost}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Text-only day: existing layout */
                  <>
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
                  </>
                )}

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

                {/* Photo analysis panel (collapsible) */}
                {isPhotoDay && photoAnalysis && (
                  <PhotoAnalysisPanel analysis={photoAnalysis} />
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
