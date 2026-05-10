import type { Post } from "@/lib/posts/types"

interface PublishedPostsProps {
  posts: Post[]
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

function formatPlatformLabel(platform: "instagram" | "facebook"): string {
  return platform === "instagram" ? "Instagram" : "Facebook"
}

export default function PublishedPosts({ posts }: PublishedPostsProps) {
  if (posts.length === 0) {
    return (
      <section>
        <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--text-primary)] mb-3">
          Geplaatst
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          Nog geen posts geplaatst.
        </p>
      </section>
    )
  }

  const recentPosts = [...posts]
    .sort((a, b) => {
      const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0
      const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0
      return dateB - dateA
    })
    .slice(0, 5)

  return (
    <section>
      <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--text-primary)] mb-3">
        Geplaatst
      </h2>

      <div className="space-y-2">
        {recentPosts.map((post) => (
          <div
            key={post.id}
            className="bg-[var(--surface-card)] border border-[var(--border-light)] rounded-lg px-3.5 py-3 flex items-center justify-between"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-[var(--text-primary)] truncate">
                {post.content}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {formatDutchDate(post.scheduledDate)} &middot;{" "}
                {formatPlatformLabel(post.platform)}
              </p>
            </div>

            {/* Metrics stub -- Meta API not wired yet */}
            <span className="text-xs text-[var(--border-medium)] ml-4 whitespace-nowrap">
              &mdash; likes
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
