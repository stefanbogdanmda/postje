"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { cancelAccountDeletionAction } from "@/app/dashboard/account/actions"

interface PendingDeletionBannerProps {
  scheduledFor: Date
}

function formatNl(date: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Amsterdam",
  }).format(date)
}

export default function PendingDeletionBanner({
  scheduledFor,
}: PendingDeletionBannerProps) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleCancel() {
    setError(null)
    startTransition(async () => {
      const result = await cancelAccountDeletionAction()
      if (!result.success) {
        setError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div
      role="alert"
      style={{
        margin: "0 0 1.5rem",
        padding: "1rem 1.25rem",
        background: "#fef3f2",
        border: "1px solid #f5a3a3",
        borderRadius: "0.5rem",
        color: "#4d1a1a",
      }}
    >
      <p style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>
        Je account wordt verwijderd op {formatNl(scheduledFor)}.
      </p>
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem" }}>
        Bedacht? Klik op &laquo;Annuleren&raquo; om het verzoek in te trekken.
      </p>
      <button
        type="button"
        onClick={handleCancel}
        disabled={pending}
        style={{
          padding: "0.5rem 0.875rem",
          background: "#1a1a1a",
          color: "#fff",
          border: "none",
          borderRadius: "0.375rem",
          cursor: pending ? "not-allowed" : "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? "Annuleren…" : "Annuleren"}
      </button>
      {error && (
        <p style={{ margin: "0.75rem 0 0", color: "#b00020", fontSize: "0.875rem" }}>
          {error}
        </p>
      )}
    </div>
  )
}
