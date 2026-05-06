import type { ClientProfile } from "@/lib/ai/types"

export const cafeDeHoek: ClientProfile = {
  name: "Café de Hoek",
  type: "Café/lunchroom (no dinner service)",
  location: "Arnhem, Netherlands",
  hours: "Tuesday–Sunday, 8:00–17:00. Closed Monday.",
  vibe: "Cozy, unpretentious, regulars-heavy. Wooden tables, mismatched chairs, fresh flowers on every table.",
  menuHighlights: [
    "Homemade appeltaart",
    "Daily soups (seasonal, made fresh)",
    "Fresh sandwiches with local ingredients",
    "Specialty coffee from a local Arnhem roaster",
    "Fresh-pressed juices",
  ],
  ownerPersona: {
    name: "Marloes",
    age: "mid-30s",
    style:
      "Warm and direct. Posts like she's talking to a friend. Uses occasional emojis (☕, 🌿) but never more than one or two per post. Never corporate. Sometimes a little humorous. Speaks in short, natural sentences.",
  },
  targetCustomers: [
    "Locals from the neighbourhood",
    "Young professionals working from laptops",
    "Parents with small kids on weekday mornings",
    "Weekend brunch crowd",
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
