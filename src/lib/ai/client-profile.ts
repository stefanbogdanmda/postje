import type { ClientProfile } from "./types"

type ClientProfileRow = {
  businessName: string
  location: string | null
  industry: string | null
  businessType: string | null
  productsServices: string | null
}

function listFromText(value: string | null, fallback: string[]): string[] {
  const items = value
    ?.split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)

  return items && items.length > 0 ? items : fallback
}

export function buildClientProfile(row: ClientProfileRow): ClientProfile {
  const type = row.businessType || row.industry || "small business"
  const location = row.location || "the Netherlands"
  const highlights = listFromText(row.productsServices, [
    "products and services customers already know",
    "everyday moments from the business",
    "behind-the-scenes updates",
  ])

  return {
    name: row.businessName,
    type,
    location,
    hours: "Use regular opening hours if known. Do not invent exact hours.",
    vibe:
      "Authentic, local, practical, and warm. Avoid corporate marketing language.",
    menuHighlights: highlights,
    ownerPersona: {
      name: "the business owner",
      age: "adult",
      style:
        "Warm, direct, and natural. Posts like they are talking to a familiar customer. Uses short sentences and avoids corporate language.",
    },
    targetCustomers: [
      "local customers",
      "returning customers",
      "people nearby who may visit soon",
    ],
    platforms: ["Instagram", "Facebook"],
    postsPerDay: 1,
    bannedPhrases: [
      "culinair",
      "smakelijke",
      "geniet van",
      "unieke ervaring",
      "passie voor",
    ],
    postLanguage: "Dutch",
  }
}
