"use client"

import { useState, useTransition } from "react"
import { exportMyDataAction } from "@/app/dashboard/account/actions"

export default function ExportDataButton() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const result = await exportMyDataAction()
      if (!result.success) {
        setError(result.error)
        return
      }

      const blob = new Blob([result.jsonBlob], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = result.filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    })
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        style={{
          padding: "0.625rem 1rem",
          background: "#1a1a1a",
          color: "#fff",
          border: "none",
          borderRadius: "0.375rem",
          cursor: pending ? "not-allowed" : "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? "Bezig met exporteren…" : "Download mijn gegevens"}
      </button>
      {error && (
        <p style={{ margin: "0.75rem 0 0", color: "#b00020", fontSize: "0.875rem" }}>
          {error}
        </p>
      )}
    </div>
  )
}
