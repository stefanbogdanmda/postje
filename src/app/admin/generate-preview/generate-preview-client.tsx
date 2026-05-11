"use client"

import { useState } from "react"

/** Return the next Tuesday as an ISO date string (YYYY-MM-DD). */
function getNextTuesday(): string {
  const now = new Date()
  const dayOfWeek = now.getDay() // 0=Sun, 1=Mon, 2=Tue
  const daysUntilTuesday = ((2 - dayOfWeek + 7) % 7) || 7
  const tuesday = new Date(now)
  tuesday.setDate(now.getDate() + daysUntilTuesday)
  return [
    tuesday.getFullYear(),
    String(tuesday.getMonth() + 1).padStart(2, "0"),
    String(tuesday.getDate()).padStart(2, "0"),
  ].join("-")
}

export default function GeneratePreviewClient({
  clientId,
}: {
  clientId: string
}) {
  const [posts, setPosts] = useState<
    Array<{
      scheduledDate: string
      posts: Array<{
        id: string
        platform: string
        content: string
        photoId: string | null
        reasoning: string
        status: string
        scheduledDate: string
      }>
    }>
  | null>(null)
  const [generationMeta, setGenerationMeta] = useState<{
    generatedCount: number
    skippedLockedCount: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    setPosts(null)
    setGenerationMeta(null)

    try {
      // Step 1: Generate posts (writes to DB)
      const startDate = getNextTuesday()
      const genResponse = await fetch("/api/generate-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          startDate,
        }),
      })
      const genData = await genResponse.json()

      if (!genResponse.ok) {
        setError(genData.error || "Generation failed")
        return
      }

      setGenerationMeta({
        generatedCount: genData.generatedCount,
        skippedLockedCount: genData.skippedLockedCount,
      })

      // Step 2: Fetch persisted posts from DB
      const endDate = genData.endDate
      const postsResponse = await fetch(
        `/api/posts?clientId=${clientId}&startDate=${startDate}&endDate=${endDate}`
      )
      const postsData = await postsResponse.json()

      if (!postsResponse.ok) {
        setError(postsData.error || "Failed to fetch posts")
        return
      }

      setPosts(postsData)
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
        Generate a week of posts for this client. Takes ~15-30 seconds (two AI
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
        {loading ? "Generating..." : "Generate Week"}
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

      {generationMeta && (
        <p style={{ fontSize: "12px", color: "#888", marginTop: "24px" }}>
          Generated {generationMeta.generatedCount} post(s), skipped{" "}
          {generationMeta.skippedLockedCount} locked day(s)
        </p>
      )}

      {posts && (
        <div style={{ marginTop: "24px" }}>
          {posts.map((day) => {
            const igPost = day.posts.find((p) => p.platform === "instagram")
            const fbPost = day.posts.find((p) => p.platform === "facebook")
            const isPhotoDay = igPost?.photoId !== null

            return (
              <div
                key={day.scheduledDate}
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
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: "8px",
                    }}
                  >
                    <h2 style={{ fontSize: "18px", fontWeight: 600 }}>
                      {day.scheduledDate}
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
                </div>

                {igPost && (
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
                      {igPost.content}
                    </p>
                  </div>
                )}

                {fbPost && (
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
                      {fbPost.content}
                    </p>
                  </div>
                )}

                {igPost && (
                  <div
                    style={{
                      borderTop: "1px solid #eee",
                      paddingTop: "12px",
                      fontSize: "13px",
                      color: "#666",
                    }}
                  >
                    <p>
                      <strong>Why:</strong> {igPost.reasoning}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
