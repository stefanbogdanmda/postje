"use client"

import { useState, useTransition } from "react"
import { cancelApprovedPostAction } from "@/app/dashboard/cancel-action"

interface CancelButtonProps {
  postId: string
}

export default function CancelButton({ postId }: CancelButtonProps) {
  const [pending, startTransition] = useTransition()
  const [cancelled, setCancelled] = useState(false)

  if (cancelled) {
    return (
      <span style={{ fontSize: "12px", color: "#737373" }}>
        Geannuleerd
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        startTransition(async () => {
          const result = await cancelApprovedPostAction(postId)
          if (result.success) {
            setCancelled(true)
          }
        })
      }}
      disabled={pending}
      style={{
        background: "none",
        border: "1px solid #e5e5e5",
        borderRadius: "4px",
        padding: "4px 8px",
        fontSize: "12px",
        color: "#737373",
        cursor: pending ? "not-allowed" : "pointer",
        opacity: pending ? 0.6 : 1,
      }}
      title="Annuleer deze post"
    >
      {pending ? "Annuleren..." : "Annuleren"}
    </button>
  )
}
