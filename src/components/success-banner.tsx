"use client"

import { useState, useEffect } from "react"

interface SuccessBannerProps {
  message: string
  /** Auto-fade after this many milliseconds. Defaults to 5000 (5 seconds). */
  fadeAfterMs?: number
}

export default function SuccessBanner({
  message,
  fadeAfterMs = 5000,
}: SuccessBannerProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), fadeAfterMs)
    return () => clearTimeout(timer)
  }, [fadeAfterMs])

  if (!visible) return null

  return (
    <div
      style={{
        padding: "12px 16px",
        backgroundColor: "#f0fdf4",
        border: "1px solid #bbf7d0",
        borderRadius: "6px",
        marginBottom: "24px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: "14px",
        color: "#166534",
      }}
    >
      <span>{message}</span>
      <button
        onClick={() => setVisible(false)}
        style={{
          background: "none",
          border: "none",
          color: "#166534",
          cursor: "pointer",
          fontSize: "18px",
          padding: "0 4px",
          lineHeight: 1,
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
