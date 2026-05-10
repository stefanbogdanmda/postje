import type { Post } from "@/lib/posts/types"

interface PostPreviewProps {
  post: Post
}

function InstagramPreview({ post }: PostPreviewProps) {
  return (
    <div className="border border-[var(--border-light)] rounded-lg overflow-hidden bg-[var(--surface-card)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="w-7 h-7 rounded-full bg-[#e8dcc8] flex items-center justify-center text-xs">
          &#9749;
        </div>
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          cafedehoek
        </span>
      </div>

      {/* Photo area */}
      <div className="bg-gradient-to-br from-[#f5f0e8] to-[#e8dcc8] h-48 flex items-center justify-center">
        <span className="text-5xl" aria-hidden="true">
          {post.photoId ? "\u{1F4F7}" : "\u{1F4DD}"}
        </span>
      </div>

      {/* Caption */}
      <div className="px-3 py-2">
        <p className="text-xs leading-relaxed text-[var(--text-primary)]">
          <span className="font-semibold">cafedehoek</span> {post.content}
        </p>
      </div>
    </div>
  )
}

function FacebookPreview({ post }: PostPreviewProps) {
  return (
    <div className="border border-[var(--border-light)] rounded-lg overflow-hidden bg-[var(--surface-card)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="w-7 h-7 rounded-full bg-[#e8dcc8] flex items-center justify-center text-xs">
          &#9749;
        </div>
        <div>
          <div className="text-xs font-semibold text-[var(--text-primary)]">
            Caf&eacute; de Hoek
          </div>
          <div className="text-[10px] text-[var(--text-muted)]">Arnhem</div>
        </div>
      </div>

      {/* Text content */}
      <div className="px-3 pb-2">
        <p className="text-xs leading-relaxed text-[var(--text-primary)]">
          {post.content}
        </p>
      </div>

      {/* Photo area (only if post has a photo) */}
      {post.photoId && (
        <div className="bg-gradient-to-br from-[#f5f0e8] to-[#e8dcc8] h-40 flex items-center justify-center">
          <span className="text-5xl" aria-hidden="true">
            {"\u{1F4F7}"}
          </span>
        </div>
      )}
    </div>
  )
}

export function PostPreview({ post }: PostPreviewProps) {
  if (post.platform === "instagram") {
    return <InstagramPreview post={post} />
  }
  return <FacebookPreview post={post} />
}
