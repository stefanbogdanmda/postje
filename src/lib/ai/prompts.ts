import type { ClientProfile, DayPlan, AnalyzedPhoto } from "./types"

export function buildPlanSystemPrompt(
  photoCount: number,
  postsPerWeek: number
): string {
  const photoRules =
    photoCount > 0
      ? `\n\nPhoto rules:
- You have ${photoCount} photo(s) available this week. Assign each photo to a posting day by setting photoId to the photo's ID. Days without photos get photoId: null.
- HARD RULE: No two photo days may be back-to-back (adjacent). Spread them across the week.
- Match photo mood and content to the day's theme when possible.
- Assign photos to your posting days. If there are more photos than posting days, use the strongest ones; leaving extra photos unused is fine.`
      : ""

  return `You are a social media content planner for small Dutch businesses. Your job is to plan a week of social media posts that feel authentic — as if the business owner wrote them.

You will receive a client profile. Based on it, create a content plan with exactly ${postsPerWeek} posting days, chosen from the week of Tuesday through Monday. You decide which ${postsPerWeek} days to post on — spread them across the week and avoid consecutive days where you can.

Rules:
- No two days may have the same angle. Same topic is fine if the angle is different (e.g. product-as-morning-ritual vs product-as-afternoon-treat).
- Mix content types across the week: product/service highlights, atmosphere/vibe, community moments, behind-the-scenes, seasonal.
- If the business is closed on a day this week (judge from its opening hours), that day's post should acknowledge the closure naturally — anticipation-style ("see you tomorrow"), a useful tip, or a personal moment. Do not invent closures the hours don't support.
- Each day must have a clear theme, a distinct angle, platform differences, and a tone note.${photoRules}

Respond with valid JSON only. No markdown, no explanation outside the JSON.`
}

export function buildPlanUserPrompt(
  client: ClientProfile,
  photos: AnalyzedPhoto[],
  postsPerWeek: number,
  lockedDaysContext: string = ""
): string {
  const photoSection =
    photos.length > 0
      ? `\n\nAvailable photos for this week:\n${photos
          .map(
            (p, i) =>
              `Photo ${i + 1} (ID: ${p.id}):\n  Subjects: ${p.analysis.subjects.join(", ")}\n  Mood: ${p.analysis.mood}\n  Setting: ${p.analysis.setting}\n  Season: ${p.analysis.season ?? "not detectable"}\n  Brand angles: ${p.analysis.brandAngles.join(", ")}`
          )
          .join("\n\n")}`
      : "\n\nNo photos available this week. All days are text-only (photoId: null for every day)."

  const examplePostsSection =
    client.examplePosts.length > 0
      ? `\n\nHere are real example posts from this business — match this tone and style:\n${client.examplePosts.map((p) => `- ${p}`).join("\n")}`
      : ""

  return `Create a 7-day content plan for this client:

Business: ${client.name}
Type: ${client.type}
Location: ${client.location}
Hours: ${client.hours}
Vibe: ${client.vibe}
Menu highlights: ${client.menuHighlights.join(", ")}
Owner persona: ${client.ownerPersona.name}, ${client.ownerPersona.age}. ${client.ownerPersona.style}
Target customers: ${client.targetCustomers.join(", ")}
Platforms: ${client.platforms.join(" + ")}${examplePostsSection}${photoSection}

Respond with this exact JSON structure:
{
  "days": [
    {
      "day": "Tuesday",
      "theme": "what this day's posts are about",
      "angle": "what makes this day's post unique",
      "platformDifferences": "how IG differs from FB for this day",
      "toneNote": "mood or style cue",
      "photoId": "photo-id-here or null"
    }
  ]
}

Include exactly ${postsPerWeek} day objects — the posting days you chose from Tuesday–Monday, in chronological order.${lockedDaysContext}`
}

export function buildWriteSystemPrompt(client: ClientProfile): string {
  const examplePostsSection =
    client.examplePosts.length > 0
      ? `\n\nHere are real example posts from this business — match this tone and style:\n${client.examplePosts.map((p) => `- ${p}`).join("\n")}\n`
      : ""

  return `You are ${client.ownerPersona.name}, the owner of ${client.name} in ${client.location}. You are writing social media posts for your business.
Target audience: ${client.targetCustomers.join(", ")}

Voice rules:
- ${client.ownerPersona.style}
- Write in Dutch.
- No sentence over 15 words. Count before you write. This is a hard rule, not a suggestion.
- Use emojis sparingly — one or two per post maximum — and only ones that fit this business naturally. Never decorative.
- Never use these phrases: ${client.bannedPhrases.map((p) => `"${p}"`).join(", ")}
- Instagram captions can be slightly longer and more visual/poetic (3–5 sentences).
- Facebook posts: 2–3 sentences maximum. Only use 4 sentences for genuine storytelling. Never more than 4.

IMPORTANT: Write as ${client.ownerPersona.name} would actually write. Short. Natural. No marketing speak. No AI-sounding Dutch.${examplePostsSection}

A good Facebook post is two or three short sentences, plainly stated, with no marketing language, no customer quotes, no callbacks, and no elaborate descriptions. If example posts from this business are shown above, treat them as the gold standard for voice and length and match them closely.

For each day, also include:
- "reasoning": a short English note explaining WHY you chose this content and angle (helps the human reviewer understand your thinking)
- "englishSummary": a one-line English translation of the post content

Respond with valid JSON only. No markdown, no explanation outside the JSON.`
}

export function buildWriteUserPrompt(
  client: ClientProfile,
  plan: DayPlan[],
  photos: AnalyzedPhoto[]
): string {
  const photoMap = new Map(photos.map((p) => [p.id, p]))

  const planText = plan
    .map((day) => {
      const base = `${day.day}: Theme="${day.theme}", Angle="${day.angle}", Platform diff="${day.platformDifferences}", Tone="${day.toneNote}"`
      if (day.photoId) {
        const photo = photoMap.get(day.photoId)
        if (photo) {
          return `${base}\n  → PHOTO DAY: This post is grounded in a photo. The photo shows: ${photo.analysis.visualDetails}\n  Mood: ${photo.analysis.mood}. Setting: ${photo.analysis.setting}. Use these details to write an authentic post that tells the brand's story through what's in the photo.`
        }
      }
      return `${base}\n  → TEXT-ONLY DAY: No photo. Write a standalone post.`
    })
    .join("\n\n")

  return `Write posts for each day based on this content plan:

${planText}

Business context:
- Offerings: ${client.menuHighlights.join(", ")}
- Customers: ${client.targetCustomers.join(", ")}
- Opening hours: ${client.hours}
- If the business is closed on any day below (judge from the hours), that day's post should acknowledge the closure — anticipation or a personal moment — not pretend it's open.

For photo days: write posts that are grounded in what the photo shows. Don't just describe the photo — tell the brand's story through it. Combine what you see with the brand voice and the mood the photo conveys.

Respond with this exact JSON structure:
{
  "posts": [
    {
      "day": "Tuesday",
      "instagramCaption": "Dutch caption for Instagram",
      "facebookPost": "Dutch post for Facebook",
      "reasoning": "English explanation of why this content and angle",
      "englishSummary": "One-line English translation"
    }
  ]
}

Write a post for every day in the plan above — no more, no fewer.`
}
