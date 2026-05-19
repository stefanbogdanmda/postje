"use client"

import { useState, useTransition } from "react"
import {
  publishPostNowAction,
  retryFailedPostAction,
} from "@/app/admin/queue/actions"

interface PublishButtonProps {
  postId: string
  mode: "publish" | "retry"
  disabled?: boolean
  disabledReason?: string | null
}

const reasonText: Record<string, string> = {
  forbidden: "Niet bevoegd.",
  "not-approved": "Post is niet (meer) goedgekeurd.",
  "no-connection": "Deze klant heeft geen Meta-koppeling.",
  "ig-no-photo": "Instagram vereist een foto. Deze post heeft er geen.",
  "permanent-token": "Meta-token verlopen. Klant opnieuw verbinden.",
  "permanent-content": "Meta weigerde de inhoud van deze post.",
  transient: "Tijdelijke fout bij Meta. Probeer het opnieuw.",
  unknown: "Onbekende fout. Zie publish_attempts voor details.",
}

export default function PublishButton({
  postId,
  mode,
  disabled = false,
  disabledReason = null,
}: PublishButtonProps) {
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{
    ok: boolean
    text: string
  } | null>(null)

  function go() {
    setFeedback(null)
    startTransition(async () => {
      const result =
        mode === "retry"
          ? await retryFailedPostAction(postId)
          : await publishPostNowAction(postId)
      if (result.success) {
        setFeedback({ ok: true, text: `Gepubliceerd (${result.metaPostId}).` })
      } else {
        const reason = result.errorReason ?? "unknown"
        const msg = reasonText[reason] ?? "Er ging iets mis."
        setFeedback({
          ok: false,
          text: result.errorMessage ? `${msg} (${result.errorMessage})` : msg,
        })
      }
    })
  }

  const baseStyle: React.CSSProperties = {
    padding: "6px 12px",
    fontSize: "13px",
    borderRadius: "4px",
    border: "1px solid var(--admin-border-strong, #d4d4d4)",
    backgroundColor: "var(--admin-surface, #ffffff)",
    color: "var(--admin-text, #1a1a1a)",
    cursor: disabled || pending ? "not-allowed" : "pointer",
    opacity: disabled || pending ? 0.6 : 1,
  }
  const retryStyle: React.CSSProperties = {
    ...baseStyle,
    color: "var(--admin-sev-warn, #b45309)",
    borderColor: "var(--admin-sev-warn, #b45309)",
  }
  const isRetry = mode === "retry"

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <button
        type="button"
        onClick={go}
        disabled={disabled || pending}
        style={isRetry ? retryStyle : baseStyle}
        title={disabledReason ?? undefined}
      >
        {pending
          ? isRetry
            ? "Opnieuw publiceren..."
            : "Publiceren..."
          : isRetry
          ? "Opnieuw publiceren"
          : "Publiceer nu"}
      </button>
      {feedback && (
        <span
          style={{
            fontSize: "12px",
            color: feedback.ok
              ? "var(--admin-text-muted, #525252)"
              : "var(--admin-sev-critical, #b91c1c)",
          }}
        >
          {feedback.text}
        </span>
      )}
      {disabled && disabledReason && (
        <span
          style={{
            fontSize: "12px",
            color: "var(--admin-text-muted, #525252)",
          }}
        >
          {disabledReason}
        </span>
      )}
    </div>
  )
}
