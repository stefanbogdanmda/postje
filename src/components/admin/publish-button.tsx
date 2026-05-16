"use client"

import { useState, useTransition } from "react"
import { publishPostNowAction, type PublishNowActionResult } from "@/app/admin/queue/actions"

interface PublishButtonProps {
  postId: string
  disabled?: boolean
  disabledReason?: string
}

type UiState =
  | { kind: "idle" }
  | { kind: "publishing" }
  | { kind: "error"; message: string }
  | { kind: "success"; metaPostId: string }

export function PublishButton({ postId, disabled, disabledReason }: PublishButtonProps) {
  const [state, setState] = useState<UiState>({ kind: "idle" })
  const [isPending, startTransition] = useTransition()

  function onClick() {
    setState({ kind: "publishing" })
    startTransition(async () => {
      const result: PublishNowActionResult = await publishPostNowAction(postId)
      if (result.ok) {
        setState({ kind: "success", metaPostId: result.metaPostId })
      } else {
        setState({ kind: "error", message: result.errorMessage })
      }
    })
  }

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        title={disabledReason}
        style={{ opacity: 0.5, cursor: "not-allowed" }}
      >
        Niet beschikbaar
      </button>
    )
  }

  if (state.kind === "success") {
    return <span style={{ color: "#15803d" }}>Geplaatst ({state.metaPostId})</span>
  }

  if (state.kind === "publishing" || isPending) {
    return <button type="button" disabled>Bezig met plaatsen…</button>
  }

  if (state.kind === "error") {
    return (
      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        <span style={{ color: "#b45309" }} title={state.message}>Mislukt: {state.message}</span>
        <button type="button" onClick={onClick}>Opnieuw proberen</button>
      </span>
    )
  }

  return (
    <button type="button" onClick={onClick}>Nu plaatsen</button>
  )
}
