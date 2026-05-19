"use client"

import { useState, useTransition } from "react"
import { flagPostAction } from "@/app/dashboard/flag-action"

interface FlagButtonProps {
  postId: string
  alreadyFlagged?: boolean
}

export default function FlagButton({ postId, alreadyFlagged = false }: FlagButtonProps) {
  const [pending, startTransition] = useTransition()
  const [flagged, setFlagged] = useState(alreadyFlagged)

  if (flagged) {
    return (
      <span className="text-xs text-red-700 inline-flex items-center gap-1">
        Gemeld
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        startTransition(async () => {
          const result = await flagPostAction(postId)
          if (result.success) {
            setFlagged(true)
          }
        })
      }}
      disabled={pending}
      className="bg-transparent border border-[var(--border-light)] rounded px-2 py-1 text-xs text-[var(--text-muted)] hover:border-red-300 hover:text-red-600 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      title="Meld een probleem met deze post"
    >
      {pending ? "Melden..." : "Melden"}
    </button>
  )
}
