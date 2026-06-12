import { describe, it, expect } from "vitest"
import {
  buildPlanSystemPrompt,
  buildPlanUserPrompt,
  buildWriteSystemPrompt,
  buildWriteUserPrompt,
} from "../prompts"
import type { ClientProfile, DayPlan, AnalyzedPhoto } from "../types"

const POSTS_PER_WEEK = 5

const testClient: ClientProfile = {
  name: "Café De Hoek",
  type: "café",
  location: "Arnhem",
  hours: "Tue–Sun 8:00–17:00",
  vibe: "Warm, gezellig, dorpscafé feel",
  menuHighlights: ["cappuccino", "appelgebak", "erwtensoep"],
  ownerPersona: {
    name: "Marian",
    age: "45",
    style: "Friendly, down-to-earth, slightly playful",
  },
  targetCustomers: ["local regulars", "families", "remote workers"],
  platforms: ["instagram", "facebook"],
  postsPerDay: 1,
  bannedPhrases: ["culinaire ervaring", "smaakbeleving"],
  postLanguage: "nl",
  examplePosts: [],
}

const testPhoto: AnalyzedPhoto = {
  id: "photo-001",
  blobUrl: "https://example.com/photo-001.jpg",
  analysis: {
    subjects: ["latte art", "wooden table"],
    mood: "cozy morning",
    season: "autumn",
    setting: "indoor café counter",
    brandAngles: ["artisan coffee", "warm atmosphere"],
    visualDetails: "A cappuccino with latte art on a rustic wooden table, morning light streaming through the window.",
  },
}

const testPlan: DayPlan[] = [
  {
    day: "Tuesday",
    theme: "Morning coffee ritual",
    angle: "First cup of the day",
    platformDifferences: "IG: poetic, FB: concise",
    toneNote: "Warm and inviting",
    photoId: "photo-001",
  },
  {
    day: "Wednesday",
    theme: "Menu spotlight",
    angle: "Homemade appelgebak",
    platformDifferences: "IG: visual focus, FB: story-driven",
    toneNote: "Proud and authentic",
    photoId: null,
  },
]

describe("buildPlanSystemPrompt", () => {
  it("contains core planning instructions", () => {
    const prompt = buildPlanSystemPrompt(0, POSTS_PER_WEEK)

    expect(prompt).toContain("social media content planner")
    expect(prompt).toContain("Dutch businesses")
    expect(prompt).toContain("5 posting days")
    expect(prompt).toContain("Tuesday through Monday")
  })

  it("reflects the requested posts-per-week count", () => {
    expect(buildPlanSystemPrompt(0, 3)).toContain("3 posting days")
    expect(buildPlanSystemPrompt(0, 6)).toContain("6 posting days")
  })

  it("includes JSON-only response instruction", () => {
    const prompt = buildPlanSystemPrompt(0, POSTS_PER_WEEK)
    expect(prompt).toContain("valid JSON only")
  })

  it("does not assume the business is a café or closes on Monday", () => {
    const prompt = buildPlanSystemPrompt(0, POSTS_PER_WEEK)
    expect(prompt).not.toContain("café is closed")
    expect(prompt).not.toContain("Monday posts acknowledge")
  })

  it("omits photo rules when no photos available", () => {
    const prompt = buildPlanSystemPrompt(0, POSTS_PER_WEEK)
    expect(prompt).not.toContain("Photo rules")
    expect(prompt).not.toContain("photo(s) available")
  })

  it("includes photo rules when photos are available", () => {
    const prompt = buildPlanSystemPrompt(3, POSTS_PER_WEEK)

    expect(prompt).toContain("Photo rules")
    expect(prompt).toContain("3 photo(s) available")
    expect(prompt).toContain("No two photo days may be back-to-back")
    expect(prompt).toContain("Assign photos to your posting days")
  })

  it("shows correct photo count", () => {
    expect(buildPlanSystemPrompt(1, POSTS_PER_WEEK)).toContain("1 photo(s) available")
    expect(buildPlanSystemPrompt(5, POSTS_PER_WEEK)).toContain("5 photo(s) available")
  })
})

describe("buildPlanUserPrompt", () => {
  it("includes client business details", () => {
    const prompt = buildPlanUserPrompt(testClient, [], POSTS_PER_WEEK)

    expect(prompt).toContain("Café De Hoek")
    expect(prompt).toContain("café")
    expect(prompt).toContain("Arnhem")
    expect(prompt).toContain("Tue–Sun 8:00–17:00")
    expect(prompt).toContain("Warm, gezellig, dorpscafé feel")
  })

  it("includes menu highlights", () => {
    const prompt = buildPlanUserPrompt(testClient, [], POSTS_PER_WEEK)
    expect(prompt).toContain("cappuccino, appelgebak, erwtensoep")
  })

  it("includes owner persona", () => {
    const prompt = buildPlanUserPrompt(testClient, [], POSTS_PER_WEEK)
    expect(prompt).toContain("Marian")
    expect(prompt).toContain("45")
    expect(prompt).toContain("Friendly, down-to-earth, slightly playful")
  })

  it("includes target customers", () => {
    const prompt = buildPlanUserPrompt(testClient, [], POSTS_PER_WEEK)
    expect(prompt).toContain("local regulars, families, remote workers")
  })

  it("includes platforms", () => {
    const prompt = buildPlanUserPrompt(testClient, [], POSTS_PER_WEEK)
    expect(prompt).toContain("instagram + facebook")
  })

  it("includes JSON structure template", () => {
    const prompt = buildPlanUserPrompt(testClient, [], POSTS_PER_WEEK)
    expect(prompt).toContain('"days"')
    expect(prompt).toContain('"theme"')
    expect(prompt).toContain('"photoId"')
    expect(prompt).toContain("exactly 5 day objects")
  })

  it("includes text-only note when no photos", () => {
    const prompt = buildPlanUserPrompt(testClient, [], POSTS_PER_WEEK)
    expect(prompt).toContain("No photos available this week")
    expect(prompt).toContain("photoId: null for every day")
  })

  it("includes photo details when photos are available", () => {
    const prompt = buildPlanUserPrompt(testClient, [testPhoto], POSTS_PER_WEEK)

    expect(prompt).toContain("Photo 1 (ID: photo-001)")
    expect(prompt).toContain("latte art, wooden table")
    expect(prompt).toContain("cozy morning")
    expect(prompt).toContain("indoor café counter")
    expect(prompt).toContain("autumn")
    expect(prompt).toContain("artisan coffee, warm atmosphere")
  })

  it("appends locked days context when provided", () => {
    const context = "\n\nNote: Tuesday and Wednesday are already locked."
    const prompt = buildPlanUserPrompt(testClient, [], POSTS_PER_WEEK, context)
    expect(prompt).toContain("Tuesday and Wednesday are already locked")
  })

  it("omits example posts section when examplePosts is empty", () => {
    const prompt = buildPlanUserPrompt(testClient, [], POSTS_PER_WEEK)
    expect(prompt).not.toContain("real example posts")
  })

  it("includes example posts section when examplePosts is provided", () => {
    const clientWithExamples: ClientProfile = {
      ...testClient,
      examplePosts: [
        "Verse soep vandaag. Kom langs!",
        "Zondag = pannenkoeken dag",
      ],
    }
    const prompt = buildPlanUserPrompt(clientWithExamples, [], POSTS_PER_WEEK)
    expect(prompt).toContain("real example posts from this business")
    expect(prompt).toContain("Verse soep vandaag. Kom langs!")
    expect(prompt).toContain("Zondag = pannenkoeken dag")
  })
})

describe("buildWriteSystemPrompt", () => {
  it("adopts the owner persona", () => {
    const prompt = buildWriteSystemPrompt(testClient)
    expect(prompt).toContain("You are Marian")
    expect(prompt).toContain("Café De Hoek")
    expect(prompt).toContain("Arnhem")
  })

  it("includes voice rules", () => {
    const prompt = buildWriteSystemPrompt(testClient)
    expect(prompt).toContain("Friendly, down-to-earth, slightly playful")
    expect(prompt).toContain("Write in Dutch")
    expect(prompt).toContain("No sentence over 15 words")
  })

  it("includes banned phrases", () => {
    const prompt = buildWriteSystemPrompt(testClient)
    expect(prompt).toContain('"culinaire ervaring"')
    expect(prompt).toContain('"smaakbeleving"')
  })

  it("includes platform-specific length guidance", () => {
    const prompt = buildWriteSystemPrompt(testClient)
    expect(prompt).toContain("Instagram captions")
    expect(prompt).toContain("Facebook posts")
    expect(prompt).toContain("3–5 sentences")
    expect(prompt).toContain("2–3 sentences")
  })

  it("includes reasoning and summary requirements", () => {
    const prompt = buildWriteSystemPrompt(testClient)
    expect(prompt).toContain('"reasoning"')
    expect(prompt).toContain('"englishSummary"')
  })

  it("requests JSON-only response", () => {
    const prompt = buildWriteSystemPrompt(testClient)
    expect(prompt).toContain("valid JSON only")
  })

  it("includes target audience", () => {
    const prompt = buildWriteSystemPrompt(testClient)
    expect(prompt).toContain("Target audience: local regulars, families, remote workers")
  })

  it("omits example posts section when examplePosts is empty", () => {
    const prompt = buildWriteSystemPrompt(testClient)
    expect(prompt).not.toContain("real example posts")
  })

  it("includes example posts section when examplePosts is provided", () => {
    const clientWithExamples: ClientProfile = {
      ...testClient,
      examplePosts: [
        "Verse soep vandaag. Kom langs!",
        "Zondag = pannenkoeken dag",
      ],
    }
    const prompt = buildWriteSystemPrompt(clientWithExamples)
    expect(prompt).toContain("real example posts from this business")
    expect(prompt).toContain("Verse soep vandaag. Kom langs!")
    expect(prompt).toContain("Zondag = pannenkoeken dag")
  })

  it("says 'your business' not 'your café' for non-café types", () => {
    const prompt = buildWriteSystemPrompt(testClient)
    expect(prompt).toContain("your business")
    expect(prompt).not.toContain("your café")
  })

  it("does not hardcode café-specific emojis or the soup example", () => {
    const prompt = buildWriteSystemPrompt(testClient)
    expect(prompt).not.toContain("☕")
    expect(prompt).not.toContain("🌿")
    expect(prompt).not.toContain("Erwtensoep")
  })
})

describe("buildWriteUserPrompt", () => {
  it("includes plan details for each day", () => {
    const prompt = buildWriteUserPrompt(testClient, testPlan, [testPhoto])

    expect(prompt).toContain("Tuesday")
    expect(prompt).toContain('Theme="Morning coffee ritual"')
    expect(prompt).toContain('Angle="First cup of the day"')
    expect(prompt).toContain("Wednesday")
    expect(prompt).toContain('Theme="Menu spotlight"')
  })

  it("marks photo days with photo details", () => {
    const prompt = buildWriteUserPrompt(testClient, testPlan, [testPhoto])

    expect(prompt).toContain("PHOTO DAY")
    expect(prompt).toContain("cappuccino with latte art")
  })

  it("marks text-only days", () => {
    const prompt = buildWriteUserPrompt(testClient, testPlan, [testPhoto])

    expect(prompt).toContain("TEXT-ONLY DAY")
  })

  it("includes menu and customer context", () => {
    const prompt = buildWriteUserPrompt(testClient, testPlan, [testPhoto])

    expect(prompt).toContain("cappuccino, appelgebak, erwtensoep")
    expect(prompt).toContain("local regulars, families, remote workers")
  })

  it("includes the business hours and a generic closure rule, not a hardcoded day", () => {
    const prompt = buildWriteUserPrompt(testClient, testPlan, [testPhoto])
    expect(prompt).toContain("Tue–Sun 8:00–17:00")
    expect(prompt).toContain("closed on any day")
    expect(prompt).not.toContain("Closed Monday")
  })

  it("includes JSON response structure", () => {
    const prompt = buildWriteUserPrompt(testClient, testPlan, [testPhoto])
    expect(prompt).toContain('"posts"')
    expect(prompt).toContain('"instagramCaption"')
    expect(prompt).toContain('"facebookPost"')
    expect(prompt).toContain('"reasoning"')
    expect(prompt).toContain('"englishSummary"')
  })

  it("handles plan with no photos", () => {
    const noPlan: DayPlan[] = [
      { ...testPlan[0], photoId: null },
      testPlan[1],
    ]
    const prompt = buildWriteUserPrompt(testClient, noPlan, [])

    expect(prompt).not.toContain("PHOTO DAY")
    expect(prompt).toContain("TEXT-ONLY DAY")
  })

  it("handles photo day when photo is not in the photos array", () => {
    // photoId is set but photo not found in the provided photos array
    const prompt = buildWriteUserPrompt(testClient, testPlan, [])
    // Should fall through to text-only because photo not found
    expect(prompt).toContain("TEXT-ONLY DAY")
  })
})
