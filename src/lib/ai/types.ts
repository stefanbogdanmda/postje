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
  photoId: string | null
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
  photoId: string | null
  photoUrl: string | null
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
    photosUsed: number
  }
}

export interface PhotoAnalysis {
  subjects: string[]
  mood: string
  season: string | null
  setting: string
  brandAngles: string[]
  visualDetails: string
}

export interface PhotoRow {
  id: string
  clientId: string
  blobUrl: string
  originalFilename: string
  mimeType: string
  sizeBytes: number
  analysis: PhotoAnalysis | null
  analyzedAt: Date | null
  createdAt: Date
}

export interface AnalyzedPhoto {
  id: string
  blobUrl: string
  analysis: PhotoAnalysis
}

export interface UploadResult {
  photo: PhotoRow
  analysisStatus: "succeeded" | "failed"
  error?: string
}
