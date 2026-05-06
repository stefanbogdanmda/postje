export interface ClientProfile {
  name: string
  type: string
  location: string
  hours: string
  vibe: string
  menuHighlights: string[]
  ownerPersona: {
    name: string
    age: string
    style: string
  }
  targetCustomers: string[]
  platforms: string[]
  postsPerDay: number
  bannedPhrases: string[]
  postLanguage: string
}

export interface DayPlan {
  day: string
  theme: string
  angle: string
  platformDifferences: string
  toneNote: string
}

export interface WeeklyPlan {
  days: DayPlan[]
}

export interface PostWarning {
  type: "banned_phrase" | "long_sentence"
  platform: "instagram" | "facebook"
  detail: string
}

export interface DayPosts {
  day: string
  instagramCaption: string
  facebookPost: string
  reasoning: string
  englishSummary: string
  warnings: PostWarning[]
}

export interface GenerationResult {
  client: { name: string; type: string; location: string }
  plan: DayPlan[]
  posts: DayPosts[]
  metadata: {
    generatedAt: string
    model: string
    planInputTokens: number
    planOutputTokens: number
    postsInputTokens: number
    postsOutputTokens: number
  }
}
