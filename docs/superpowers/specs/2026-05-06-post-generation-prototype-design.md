# Post Generation Prototype — Design Spec

Date: 2026-05-06
Status: Draft

## Goal

Prove that Claude API can generate social media posts that feel human, varied, and platform-appropriate for a Dutch small business — before building any UI, database integration, or auth around it.

Success = reading the output and thinking "yeah, a real café owner could have posted this."

## Scope

- Hardcoded fictional client profile (no DB)
- Single API route: `GET /api/generate-posts`
- Two Claude API calls (plan → write)
- Output: JSON viewable in browser
- No auth, no DB writes, no publishing, no cron

## Fictional Client: Café de Hoek

| Field | Value |
|-------|-------|
| Business name | Café de Hoek |
| Type | Café/lunchroom (no dinner) |
| Location | Arnhem, Netherlands |
| Hours | Tue–Sun, 8:00–17:00. Closed Monday. |
| Vibe | Cozy, unpretentious, regulars-heavy. Wooden tables, mismatched chairs, fresh flowers. |
| Menu highlights | Homemade appeltaart, daily soups, fresh sandwiches, specialty coffee (local roaster), fresh juices |
| Owner persona | Marloes, mid-30s. Warm and direct. Posts like she's talking to a friend. Occasional emojis (☕, 🌿) but not excessive. Never corporate. Sometimes a little humorous. |
| Target customers | Locals, young professionals with laptops, parents with small kids on weekday mornings, weekend brunch crowd |
| Platforms | Instagram + Facebook |
| Posting frequency | 1 post per platform per day (14 total/week) |
| Banned phrases | "culinair", "smakelijke", "geniet van", "unieke ervaring", "passie voor" |
| Post language | Dutch |

## Two-Stage Pipeline

### Stage 1: Content Plan

Input: Client profile + generation constraints.

Claude generates a weekly content plan (structured JSON) with for each day:
- **Theme/topic** — what this day's posts are about
- **Content angle** — what makes it distinct from other days
- **Platform differences** — how IG version differs from FB version
- **Tone note** — any specific mood or style cue

Plan prompt enforces:
- Variety across the week (same topic is fine if the angle is different — e.g. coffee-as-morning-ritual vs coffee-as-afternoon-pickup — but no two days with the same angle)
- Mix of content types: product highlights, atmosphere/vibe, community moments, behind-the-scenes, seasonal
- Monday posts acknowledge the café is closed (anticipation-style or recipe/tip content)

### Stage 2: Post Writing

Input: Client profile + content plan from Stage 1.

Claude writes the actual posts. For each of the 7 days, output includes:
- **instagram_caption** — Dutch, platform-appropriate
- **facebook_post** — Dutch, platform-appropriate
- **reasoning** — short English note: why this topic, angle, tone
- **english_summary** — one-line English translation

Writing prompt enforces hard constraints:
- Short sentences (target max ~15 words per sentence)
- Emoji usage matches Marloes's style (light, no emoji chains)
- Banned phrases list enforced
- Platform-appropriate length (IG captions can be visual/longer, FB more conversational)

## API Route

`GET /api/generate-posts`

Returns JSON:

```json
{
  "client": { "name": "Café de Hoek", "..." },
  "plan": [
    {
      "day": "Tuesday",
      "theme": "...",
      "angle": "...",
      "platform_differences": "...",
      "tone_note": "..."
    }
  ],
  "posts": [
    {
      "day": "Tuesday",
      "instagram_caption": "...",
      "facebook_post": "...",
      "reasoning": "...",
      "english_summary": "..."
    }
  ],
  "metadata": {
    "generated_at": "2026-05-06T14:30:00Z",
    "model": "claude-sonnet-4-6",
    "plan_tokens": 1234,
    "posts_tokens": 5678
  }
}
```

## Display Page

A simple page at `/admin/generate-preview` (or similar) that:
- Has a "Generate" button
- Calls the API route
- Displays the result in a readable format (plan + posts grouped by day)
- Shows the reasoning alongside each post
- No editing, no saving, no approving — just reading

This is a developer tool for evaluating output quality, not a client-facing feature.

## Model Choice

Use `claude-sonnet-4-6` for both calls. It's the best coding/generation model and cost-effective for a prototype. If quality isn't good enough, we can try `claude-opus-4-6` as an experiment.

## What This Proves

If the output passes the "feels human" test:
1. The two-stage approach (plan → write) works for content variety
2. Hard constraints (banned phrases, sentence length, emoji rules) are enforceable via prompts
3. Platform differentiation is achievable from the same source material
4. The client profile format contains enough information to generate good content

If it fails, we learn specifically what's wrong: bad tone? repetitive? too generic? wrong platform style? — and we iterate on the prompts before building anything else.

## Out of Scope

- Photo/image generation or handling
- Database storage of posts
- Client authentication or multi-tenancy
- Publishing to Meta platforms
- Regeneration/rejection flow
- Production error handling or rate limiting
