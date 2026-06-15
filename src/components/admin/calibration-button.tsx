"use client"

import { useState } from "react"
import { extendCalibration } from "@/app/admin/clients/actions"

export default function CalibrationButton({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function handle() {
    setLoading(true)
    setMsg(null)
    const result = await extendCalibration(clientId)
    setOk(result.success)
    setMsg(
      result.success
        ? "Calibration window reset — another 14 days of spot-checks."
        : result.error ?? "Couldn't extend calibration."
    )
    setLoading(false)
  }

  return (
    <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid #eee" }}>
      <h2 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 4px" }}>
        Calibration
      </h2>
      <p style={{ color: "#666", fontSize: "12px", margin: "0 0 12px" }}>
        Reset the 14-day calibration window if this client still needs closer
        spot-checks before going hands-off.
      </p>
      <button
        type="button"
        onClick={handle}
        disabled={loading}
        style={{
          padding: "10px 16px",
          background: "#fff",
          color: "#1a1a1a",
          border: "1px solid #ddd",
          borderRadius: "6px",
          fontSize: "14px",
          fontWeight: 500,
          cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? "Saving…" : "Extend calibration (14 days)"}
      </button>
      {msg && (
        <p style={{ fontSize: "13px", marginTop: "10px", color: ok ? "#16a34a" : "#991b1b" }}>
          {msg}
        </p>
      )}
    </div>
  )
}
