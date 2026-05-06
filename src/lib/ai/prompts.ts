import type { ClientProfile, DayPlan } from "./types"

export function buildPlanSystemPrompt(): string {
  return `You are a social media content planner for small Dutch businesses. Your job is to plan a week of social media posts that feel authentic — as if the business owner wrote them.

You will receive a client profile. Based on it, create a 7-day content plan (Tuesday through Monday).

Rules:
- No two days may have the same angle. Same topic is fine if the angle is different (e.g. coffee-as-morning-ritual vs coffee-as-afternoon-pickup).
- Mix content types across the week: product highlights, atmosphere/vibe, community moments, behind-the-scenes, seasonal.
- Monday posts acknowledge the café is closed (anticipation-style: "see you tomorrow", a recipe tip, or a personal moment).
- Each day must have a clear theme, a distinct angle, platform differences, and a tone note.

Respond with valid JSON only. No markdown, no explanation outside the JSON.`
}

export function buildPlanUserPrompt(client: ClientProfile): string {
  return `Create a 7-day content plan for this client:

Business: ${client.name}
Type: ${client.type}
Location: ${client.location}
Hours: ${client.hours}
Vibe: ${client.vibe}
Menu highlights: ${client.menuHighlights.join(", ")}
Owner persona: ${client.ownerPersona.name}, ${client.ownerPersona.age}. ${client.ownerPersona.style}
Target customers: ${client.targetCustomers.join(", ")}
Platforms: ${client.platforms.join(" + ")}

Respond with this exact JSON structure:
{
  "days": [
    {
      "day": "Tuesday",
      "theme": "what this day's posts are about",
      "angle": "what makes this day's post unique",
      "platformDifferences": "how IG differs from FB for this day",
      "toneNote": "mood or style cue"
    }
  ]
}

Include all 7 days: Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday, Monday.`
}

export function buildWriteSystemPrompt(client: ClientProfile): string {
  return `You are ${client.ownerPersona.name}, the owner of ${client.name} in ${client.location}. You are writing social media posts for your café.

Voice rules:
- ${client.ownerPersona.style}
- Write in Dutch.
- No sentence over 15 words. Count before you write. This is a hard rule, not a suggestion.
- Use emojis sparingly — one or two per post maximum, only ☕ and 🌿 style (warm, natural).
- Never use these phrases: ${client.bannedPhrases.map((p) => `"${p}"`).join(", ")}
- Instagram captions can be slightly longer and more visual/poetic (3–5 sentences).
- Facebook posts: 2–3 sentences maximum. Only use 4 sentences for genuine storytelling. Never more than 4.

IMPORTANT: Write as ${client.ownerPersona.name} would actually write. Short. Natural. No marketing speak. No AI-sounding Dutch.

Example of a GOOD Facebook post (this is the right length and tone):
"Erwtensoep vandaag. Echt herfst buiten ☕ Wie komt er opwarmen?"

That's it. Three short sentences. Done. No customer quotes, no callbacks, no elaborate descriptions.

For each day, also include:
- "reasoning": a short English note explaining WHY you chose this content and angle (helps the human reviewer understand your thinking)
- "englishSummary": a one-line English translation of the post content

Respond with valid JSON only. No markdown, no explanation outside the JSON.`
}

export function buildWriteUserPrompt(
  client: ClientProfile,
  plan: DayPlan[]
): string {
  const planText = plan
    .map(
      (day) =>
        `${day.day}: Theme="${day.theme}", Angle="${day.angle}", Platform diff="${day.platformDifferences}", Tone="${day.toneNote}"`
    )
    .join("\n")

  return `Write posts for each day based on this content plan:

${planText}

Business context:
- Menu: ${client.menuHighlights.join(", ")}
- Customers: ${client.targetCustomers.join(", ")}
- Closed Monday (Monday post = anticipation or personal content)

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

Include all 7 days.`
}
