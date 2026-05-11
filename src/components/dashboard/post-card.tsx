import type { Post } from "@/lib/posts/types"

interface PostCardProps {
  post: Post
  onClick: () => void
  index: number
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

export function PostCard({ post, onClick, index }: PostCardProps) {
  const isInstagram = post.platform === "instagram"

  return (
    <button
      type="button"
      onClick={onClick}
      className="animate-card-appear bg-[var(--surface-card)] rounded-xl overflow-hidden border border-[var(--border-light)] shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-elevated)] transition-shadow w-full text-left"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Image placeholder with platform badge */}
      <div className="relative h-32 bg-gradient-to-br from-[var(--surface-muted)] to-[var(--border-light)] flex items-center justify-center overflow-hidden">
        {post.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.photoUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <span className="text-2xl" aria-hidden="true">
            {post.photoId ? "\u{1F4F7}" : "\u{1F4DD}"}
          </span>
        )}

        <span className="absolute top-2 right-2 flex items-center gap-1.5 bg-white/90 backdrop-blur-sm text-xs font-medium px-2 py-1 rounded-full">
          <span
            className="block w-2 h-2 rounded-full shrink-0"
            style={{
              background: isInstagram
                ? "linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)"
                : "#1877f2",
            }}
          />
          {isInstagram ? "IG" : "FB"}
        </span>
      </div>

      {/* Caption and date */}
      <div className="p-3">
        <p className="text-sm text-[var(--text-primary)] leading-snug line-clamp-2">
          {post.content}
        </p>
        <p className="text-xs text-[var(--text-muted)] mt-2">
          {formatDutchDate(post.scheduledDate)}
        </p>
      </div>
    </button>
  )
}
