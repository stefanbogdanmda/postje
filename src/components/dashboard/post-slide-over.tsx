"use client"

import { useEffect } from "react"
import type { Post } from "@/lib/posts/types"
import { PostPreview } from "./post-preview"
import { PostActions } from "./post-actions"

interface PostSlideOverProps {
  post: Post
  onClose: () => void
  onApproved: (postId: string) => void
  onRejected: (postId: string) => void
  onRegenerated: (updatedPost: Post) => void
  onApproveError: () => void
}

export function PostSlideOver({
  post,
  onClose,
  onApproved,
  onRejected,
  onRegenerated,
  onApproveError,
}: PostSlideOverProps) {
  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  // Prevent body scroll while panel is open
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  return (
    <div className="fixed inset-0 z-40">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/20 animate-fade-overlay"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="absolute right-0 top-0 bottom-0 w-full sm:w-[60%] sm:max-w-2xl bg-[var(--surface-card)] shadow-[var(--shadow-elevated)] flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-light)]">
          <h2 className="font-[family-name:var(--font-display)] text-base text-[var(--text-primary)]">
            Post beoordelen
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-md border border-[var(--border-light)] flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="flex flex-col sm:flex-row gap-6">
            <div className="sm:w-1/2">
              <PostPreview post={post} />
            </div>
            <div className="sm:w-1/2">
              <PostActions
                post={post}
                onApproved={onApproved}
                onRejected={onRejected}
                onRegenerated={onRegenerated}
                onApproveError={onApproveError}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
