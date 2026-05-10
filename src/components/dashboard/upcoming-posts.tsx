import type { Post } from "@/lib/posts/types"

interface UpcomingPostsProps {
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

function groupByDate(posts: Post[]): Map<string, Post[]> {
  const grouped = new Map<string, Post[]>()

  for (const post of posts) {
    const existing = grouped.get(post.scheduledDate)
    if (existing) {
      grouped.set(post.scheduledDate, [...existing, post])
    } else {
      grouped.set(post.scheduledDate, [post])
    }
  }

  return new Map(
    [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))
  )
}

function getPlatformPills(posts: Post[]): string[] {
  const platforms = new Set(
    posts.map((p) => (p.platform === "instagram" ? "IG" : "FB"))
  )
  return [...platforms].sort()
}

export default function UpcomingPosts({ posts }: UpcomingPostsProps) {
  if (posts.length === 0) {
    return (
      <section>
        <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--text-primary)] mb-3">
          Binnenkort
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          Nog geen goedgekeurde posts deze week.
        </p>
      </section>
    )
  }

  const grouped = groupByDate(posts)

  return (
    <section>
      <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--text-primary)] mb-3">
        Binnenkort
      </h2>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {[...grouped.entries()].map(([date, dayPosts]) => (
          <div
            key={date}
            className="bg-[var(--approved-bg)] border border-[var(--approved-border)] rounded-lg px-3.5 py-2.5 min-w-[120px] flex-shrink-0"
          >
            <p className="text-sm font-semibold text-[var(--approved-text)]">
              {formatDutchDate(date)}
            </p>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              {dayPosts.length} {dayPosts.length === 1 ? "post" : "posts"}
            </p>
            <div className="flex gap-1 mt-1.5">
              {getPlatformPills(dayPosts).map((pill) => (
                <span
                  key={pill}
                  className="text-xs bg-white px-1.5 py-0.5 rounded text-[var(--text-muted)]"
                >
                  {pill}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
