"use client"

import { useCallback, useEffect, useState } from "react"
import type { Post } from "@/lib/posts/types"
import { PostCard } from "./post-card"
import { PostSlideOver } from "./post-slide-over"

interface PendingPostsProps {
  posts: Post[]
}

export default function PendingPosts({ posts: initialPosts }: PendingPostsProps) {
  const [posts, setPosts] = useState<Post[]>(initialPosts)
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const selectedPost = selectedPostId
    ? posts.find((p) => p.id === selectedPostId) ?? null
    : null

  // Auto-clear toast after 4 seconds
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const handlePostApproved = useCallback((postId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId))
    setSelectedPostId(null)
    setToast("Post goedgekeurd!")
  }, [])

  const handlePostRejected = useCallback((postId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId))
    setSelectedPostId(null)
  }, [])

  const handlePostRegenerated = useCallback((updatedPost: Post) => {
    setPosts((prev) =>
      prev.map((p) => (p.id === updatedPost.id ? updatedPost : p))
    )
  }, [])

  const handleApproveError = useCallback(() => {
    setToast("Kon niet goedkeuren, probeer opnieuw.")
  }, [])

  return (
    <section>
      {/* Section header */}
      <div className="flex items-center gap-2.5 mb-4">
        <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--text-primary)]">
          Te beoordelen
        </h2>
        {posts.length > 0 && (
          <span className="bg-[var(--accent-pending)] text-white text-xs font-semibold px-2 py-0.5 rounded-full">
            {posts.length}
          </span>
        )}
      </div>

      {/* Empty state or card grid */}
      {posts.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          Geen posts om te beoordelen. Alles is up-to-date!
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {posts.map((post, index) => (
            <PostCard
              key={post.id}
              post={post}
              onClick={() => setSelectedPostId(post.id)}
              index={index}
            />
          ))}
        </div>
      )}

      {/* Slide-over for selected post */}
      {selectedPost && (
        <PostSlideOver
          post={selectedPost}
          onClose={() => setSelectedPostId(null)}
          onApproved={handlePostApproved}
          onRejected={handlePostRejected}
          onRegenerated={handlePostRegenerated}
          onApproveError={handleApproveError}
        />
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[var(--text-primary)] text-[var(--surface-bg)] text-sm px-4 py-2.5 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </section>
  )
}
