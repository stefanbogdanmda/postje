"use client"

import { useState, useTransition } from "react"
import type { Post } from "@/lib/posts/types"
import { MAX_REJECTIONS } from "@/lib/posts/config"
import {
  approvePostAction,
  rejectPostAction,
  regeneratePostAction,
} from "@/lib/posts/actions"

interface PostActionsProps {
  post: Post
  onApproved: (postId: string) => void
  onRejected: (postId: string) => void
  onRegenerated: (updatedPost: Post) => void
  onApproveError: () => void
}

function formatDutchDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00")
  const days = ["zo", "ma", "di", "wo", "do", "vr", "za"]
  const months = [
    "jan", "feb", "mrt", "apr", "mei", "jun",
    "jul", "aug", "sep", "okt", "nov", "dec",
  ]
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`
}

export function PostActions({
  post,
  onApproved,
  onRejected,
  onRegenerated,
  onApproveError,
}: PostActionsProps) {
  const [caption, setCaption] = useState(post.content)
  const [mode, setMode] = useState<"actions" | "feedback" | "regenerating">("actions")
  const [feedback, setFeedback] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const isEdited = caption !== post.content
  const isInstagram = post.platform === "instagram"
  const atMaxRejections = post.rejectionCount >= MAX_REJECTIONS

  function handleApprove() {
    startTransition(async () => {
      const result = await approvePostAction(
        post.id,
        isEdited ? caption : undefined
      )
      if (result.success) {
        onApproved(post.id)
      } else {
        onApproveError()
      }
    })
  }

  function handleReject() {
    startTransition(async () => {
      const result = await rejectPostAction(post.id)
      if (result.success) {
        onRejected(post.id)
      } else {
        setError(result.error ?? "Er ging iets mis.")
      }
    })
  }

  function handleRequestChanges() {
    if (atMaxRejections) {
      setError(
        "Je hebt het maximum aantal wijzigingen bereikt. Neem contact op met Stefan."
      )
      return
    }
    setMode("feedback")
  }

  function handleRegenerate() {
    if (feedback.trim().length < 10) return

    setMode("regenerating")
    startTransition(async () => {
      const result = await regeneratePostAction(post.id, feedback)
      if (result.success && result.post) {
        setCaption(result.post.content)
        setFeedback("")
        setMode("actions")
        onRegenerated(result.post)
      } else {
        setError(result.error ?? "Er ging iets mis.")
        setMode("feedback")
      }
    })
  }

  return (
    <div className="flex flex-col">
      {/* Platform & date row */}
      <div className="flex gap-4 mb-5">
        <div>
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Platform
          </span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className="block w-2 h-2 rounded-full shrink-0"
              style={{
                background: isInstagram
                  ? "linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)"
                  : "#1877f2",
              }}
            />
            <span className="text-sm text-[var(--text-primary)]">
              {isInstagram ? "Instagram" : "Facebook"}
            </span>
          </div>
        </div>
        <div>
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Datum
          </span>
          <div className="text-sm text-[var(--text-primary)] mt-0.5">
            {formatDutchDate(post.scheduledDate)}
          </div>
        </div>
      </div>

      {/* Editable caption */}
      <div className="mb-5 flex-1">
        <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          Tekst
          {isEdited && (
            <span className="text-[var(--accent-edit)]"> &middot; bewerkt</span>
          )}
        </label>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          className={`w-full rounded-lg p-3 text-sm text-[var(--text-primary)] leading-relaxed min-h-[100px] resize-none mt-1 ${
            isEdited
              ? "border-2 border-[var(--accent-edit)] bg-[#f0f5f8]"
              : "border border-[var(--border-medium)] bg-[var(--surface-muted)]"
          }`}
        />
        {!isEdited && (
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Klik om de tekst aan te passen
          </p>
        )}
      </div>

      {/* Error message */}
      {error && (
        <p className="text-sm text-[var(--accent-pending)] mb-3">{error}</p>
      )}

      {/* Mode: actions */}
      {mode === "actions" && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleApprove}
            disabled={isPending}
            className="bg-[var(--text-primary)] text-[var(--surface-bg)] text-sm font-medium py-2.5 px-4 rounded-lg hover:opacity-90 disabled:opacity-60"
          >
            {isPending
              ? "Even geduld..."
              : isEdited
                ? "Goedkeuren met aanpassingen"
                : "Goedkeuren"}
          </button>
          <button
            type="button"
            onClick={handleRequestChanges}
            disabled={isPending}
            className="border border-[var(--border-medium)] text-[var(--text-primary)] text-sm py-2.5 px-4 rounded-lg hover:bg-[var(--surface-muted)] disabled:opacity-60"
          >
            Aanpassingen vragen
          </button>
          <button
            type="button"
            onClick={() => handleReject()}
            disabled={isPending}
            className="text-[var(--text-muted)] text-sm py-2 hover:text-[var(--text-secondary)]"
          >
            Overslaan
          </button>
        </div>
      )}

      {/* Mode: feedback */}
      {mode === "feedback" && (
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Wat wil je anders?
          </label>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={'Bijv. "Minder emoji\'s" of "Meer over de appeltaart"'}
            className="w-full rounded-lg p-3 text-sm text-[var(--text-primary)] leading-relaxed min-h-[100px] resize-none mt-1 border border-[var(--border-medium)] bg-[var(--surface-muted)]"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Minimaal 10 tekens
          </p>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={feedback.trim().length < 10}
              className="bg-[var(--text-primary)] text-[var(--surface-bg)] text-sm font-medium py-2.5 px-4 rounded-lg hover:opacity-90 disabled:opacity-60"
            >
              Opnieuw genereren
            </button>
            <button
              type="button"
              onClick={() => setMode("actions")}
              className="border border-[var(--border-medium)] text-[var(--text-primary)] text-sm py-2.5 px-4 rounded-lg hover:bg-[var(--surface-muted)]"
            >
              Annuleren
            </button>
          </div>
        </div>
      )}

      {/* Mode: regenerating */}
      {mode === "regenerating" && (
        <div className="text-center py-6">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            Even geduld...
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            We maken een nieuwe versie van je post.
          </p>
        </div>
      )}
    </div>
  )
}
