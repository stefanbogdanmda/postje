import type { ClientProfile } from "./types"

type ClientProfileRow = {
  businessName: string
  location: string | null
  industry: string | null
  businessType: string | null
  productsServices: string | null
  toneOfVoice: string | null
  targetCustomers: string | null
  brandPersonality: string | null
  bannedPhrases: string[] | null
  examplePosts: string[] | null
}

const DEFAULT_BANNED_PHRASES = [
  "culinair",
  "smakelijke",
  "geniet van",
  "unieke ervaring",
  "passie voor",
]

const DEFAULT_TARGET_CUSTOMERS = [
  "local customers",
  "returning customers",
  "people nearby who may visit soon",
]

const DEFAULT_VIBE =
  "Authentic, local, practical, and warm. Avoid corporate marketing language."

const DEFAULT_PERSONA_STYLE =
  "Warm, direct, and natural. Posts like they are talking to a familiar customer. Uses short sentences and avoids corporate language."

function listFromText(value: string | null, fallback: string[]): string[] {
  const items = value
    ?.split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)

  return items && items.length > 0 ? items : fallback
}

/**
 * Merges DB-stored banned phrases with the default list.
 * DB phrases come first (higher priority), defaults fill in the rest.
 * Duplicates are removed (case-insensitive).
 */
function mergeBannedPhrases(dbPhrases: string[] | null): string[] {
  if (!dbPhrases || dbPhrases.length === 0) {
    return DEFAULT_BANNED_PHRASES
  }

  const seen = new Set(dbPhrases.map((p) => p.toLowerCase()))
  const merged = [...dbPhrases]

  for (const defaultPhrase of DEFAULT_BANNED_PHRASES) {
    if (!seen.has(defaultPhrase.toLowerCase())) {
      merged.push(defaultPhrase)
    }
  }

  return merged
}

export function buildClientProfile(row: ClientProfileRow): ClientProfile {
  const type = row.businessType || row.industry || "small business"
  const location = row.location || "the Netherlands"
  const highlights = listFromText(row.productsServices, [
    "products and services customers already know",
    "everyday moments from the business",
    "behind-the-scenes updates",
  ])

  const vibe = row.toneOfVoice || DEFAULT_VIBE
  const personaStyle = row.brandPersonality || DEFAULT_PERSONA_STYLE
  const targetCustomers = listFromText(
    row.targetCustomers,
    DEFAULT_TARGET_CUSTOMERS
  )
  const bannedPhrases = mergeBannedPhrases(row.bannedPhrases)
  const examplePosts = row.examplePosts ?? []

  return {
    name: row.businessName,
    type,
    location,
    hours: "Use regular opening hours if known. Do not invent exact hours.",
    vibe,
    menuHighlights: highlights,
    ownerPersona: {
      name: "the business owner",
      age: "adult",
      style: personaStyle,
    },
    targetCustomers,
    platforms: ["Instagram", "Facebook"],
    postsPerDay: 1,
    bannedPhrases,
    postLanguage: "Dutch",
    examplePosts,
  }
}
