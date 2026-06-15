"use client"

import { useState } from "react"
import { notifyClientPostsReady } from "@/app/admin/clients/actions"

export default function NotifyClientButton({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function handle() {
    setLoading(true)
    setMsg(null)
    const result = await notifyClientPostsReady(clientId)
    setOk(result.success)
    setMsg(
      result.success
        ? "Client notified — the email has been sent."
        : result.error ?? "Couldn't notify the client."
    )
    setLoading(false)
  }

  return (
    <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid #eee" }}>
      <h2 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 4px" }}>
        Notify client
      </h2>
      <p style={{ color: "#666", fontSize: "12px", margin: "0 0 12px" }}>
        Email the client that this week&apos;s posts are ready for their review.
      </p>
      <button
        type="button"
        onClick={handle}
        disabled={loading}
        style={{
          padding: "10px 16px",
          background: "#1a1a1a",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          fontSize: "14px",
          fontWeight: 500,
          cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? "Sending…" : "Notify client — posts ready"}
      </button>
      {msg && (
        <p style={{ fontSize: "13px", marginTop: "10px", color: ok ? "#16a34a" : "#991b1b" }}>
          {msg}
        </p>
      )}
    </div>
  )
}
