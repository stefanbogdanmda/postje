# Post Generation Prototype — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove Claude API generates human-feeling social media posts for a Dutch café via a two-stage pipeline (plan → write), accessible through an API route and a simple preview page.

**Architecture:** Single API route (`GET /api/generate-posts`) calls Claude twice — first to plan a week of content, then to write the posts based on that plan. A minimal admin page displays the result in a readable format.

**Tech Stack:** Next.js App Router, `@anthropic-ai/sdk`, TypeScript, Tailwind CSS (already in project)

---

## File Structure

```
src/
├── lib/
│   └── ai/
│       ├── client.ts              — Anthropic SDK client singleton
│       ├── prompts.ts             — System prompts for plan + write stages
│       └── types.ts               — TypeScript types for plan/posts output
├── data/
│   └── clients/
│       └── cafe-de-hoek.ts        — Hardcoded fictional client profile
├── app/
│   ├── api/
│   │   └── generate-posts/
│   │       └── route.ts           — GET handler: two-stage generation
│   └── admin/
│       └── generate-preview/
│           └── page.tsx           — Preview page with Generate button
```

---

## Task 1: Install Anthropic SDK

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the SDK**

Run:
```bash
npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Add `ANTHROPIC_API_KEY` to `.env.example`**

Add this line to `.env.example`:
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

- [ ] **Step 3: Verify your local `.env.local` has the real key set**

The key should already exist in your `.env.local` (from Claude API access). Confirm by running:
```bash
grep ANTHROPIC_API_KEY .env.local
```
Expected: a line with your actual key (don't share it).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add @anthropic-ai/sdk dependency"
```

---

## Task 2: Define types and client profile

**Files:**
- Create: `src/lib/ai/types.ts`
- Create: `src/data/clients/cafe-de-hoek.ts`

- [ ] **Step 1: Create the types file**

Create `src/lib/ai/types.ts`:

```typescript
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
```

- [ ] **Step 2: Create the client profile**

Create `src/data/clients/cafe-de-hoek.ts`:

```typescript
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
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/types.ts src/data/clients/cafe-de-hoek.ts
git commit -m "feat: add AI types and Café de Hoek client profile"
```

---

## Task 3: Create Anthropic client and prompts

**Files:**
- Create: `src/lib/ai/client.ts`
- Create: `src/lib/ai/prompts.ts`

- [ ] **Step 1: Create the Anthropic client**

Create `src/lib/ai/client.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk"

let clientInstance: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (!clientInstance) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to your .env.local file."
      )
    }
    clientInstance = new Anthropic({ apiKey })
  }
  return clientInstance
}
```

- [ ] **Step 2: Create the prompts file**

Create `src/lib/ai/prompts.ts`:

```typescript
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
- Keep sentences short. Target max 15 words per sentence.
- Use emojis sparingly — one or two per post maximum, only ☕ and 🌿 style (warm, natural).
- Never use these phrases: ${client.bannedPhrases.map((p) => `"${p}"`).join(", ")}
- Instagram captions can be slightly longer and more visual/poetic.
- Facebook posts are more conversational, like talking to a neighbour.

IMPORTANT: Write as Marloes would actually write. Short. Natural. No marketing speak. No AI-sounding Dutch.

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
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/client.ts src/lib/ai/prompts.ts
git commit -m "feat: add Anthropic client and generation prompts"
```

---

## Task 4: JSON extraction and post validation helpers

**Files:**
- Create: `src/lib/ai/extract-json.ts`
- Create: `src/lib/ai/validate-posts.ts`

- [ ] **Step 1: Create the JSON extraction helper**

Claude sometimes wraps JSON in markdown fences or adds a sentence before/after it. This helper strips that reliably.

Create `src/lib/ai/extract-json.ts`:

```typescript
/**
 * Extracts JSON from a Claude response that might be wrapped in markdown
 * fences or have surrounding text. Finds the first { ... } or [ ... ] block.
 */
export function extractJSON<T>(raw: string): T {
  // Strip markdown fences if present
  let cleaned = raw.trim()
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim()
  }

  // If it still doesn't start with { or [, find the first occurrence
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const firstBrace = cleaned.indexOf("{")
    const firstBracket = cleaned.indexOf("[")
    const start = Math.min(
      firstBrace === -1 ? Infinity : firstBrace,
      firstBracket === -1 ? Infinity : firstBracket
    )
    if (start === Infinity) {
      throw new Error("No JSON object or array found in response")
    }
    cleaned = cleaned.slice(start)
  }

  return JSON.parse(cleaned) as T
}
```

- [ ] **Step 2: Create the post validation helper**

Create `src/lib/ai/validate-posts.ts`:

```typescript
import type { DayPosts, PostWarning } from "./types"

const MAX_SENTENCE_WORDS = 15

/**
 * Splits text into sentences (Dutch-aware: handles abbreviations poorly,
 * but good enough for a prototype).
 */
function splitSentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * Validates a set of generated posts against hard constraints.
 * Returns posts with a warnings array attached to each day.
 */
export function validatePosts(
  posts: Omit<DayPosts, "warnings">[],
  bannedPhrases: string[]
): DayPosts[] {
  return posts.map((post) => {
    const warnings: PostWarning[] = []

    // Check both platforms
    const platforms: Array<{
      key: "instagram" | "facebook"
      text: string
    }> = [
      { key: "instagram", text: post.instagramCaption },
      { key: "facebook", text: post.facebookPost },
    ]

    for (const { key, text } of platforms) {
      const lower = text.toLowerCase()

      // Banned phrase check
      for (const phrase of bannedPhrases) {
        if (lower.includes(phrase.toLowerCase())) {
          warnings.push({
            type: "banned_phrase",
            platform: key,
            detail: `Contains banned phrase: "${phrase}"`,
          })
        }
      }

      // Sentence length check
      const sentences = splitSentences(text)
      for (const sentence of sentences) {
        const wordCount = sentence.split(/\s+/).length
        if (wordCount > MAX_SENTENCE_WORDS) {
          warnings.push({
            type: "long_sentence",
            platform: key,
            detail: `Sentence has ${wordCount} words (max ${MAX_SENTENCE_WORDS}): "${sentence.slice(0, 60)}…"`,
          })
        }
      }
    }

    return { ...post, warnings }
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/extract-json.ts src/lib/ai/validate-posts.ts
git commit -m "feat: add JSON extraction and post validation helpers"
```

---

## Task 5: Build the API route (core logic)

**Files:**
- Create: `src/app/api/generate-posts/route.ts`

- [ ] **Step 1: Create the API route**

Create `src/app/api/generate-posts/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { getAnthropicClient } from "@/lib/ai/client"
import {
  buildPlanSystemPrompt,
  buildPlanUserPrompt,
  buildWriteSystemPrompt,
  buildWriteUserPrompt,
} from "@/lib/ai/prompts"
import { extractJSON } from "@/lib/ai/extract-json"
import { validatePosts } from "@/lib/ai/validate-posts"
import { cafeDeHoek } from "@/data/clients/cafe-de-hoek"
import type { WeeklyPlan, DayPosts, GenerationResult } from "@/lib/ai/types"

const MODEL = "claude-sonnet-4-6"

export async function GET() {
  try {
    const client = getAnthropicClient()

    // Stage 1: Generate content plan
    const planResponse = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: buildPlanSystemPrompt(),
      messages: [{ role: "user", content: buildPlanUserPrompt(cafeDeHoek) }],
    })

    const planText = planResponse.content.find((b) => b.type === "text")
    if (!planText || planText.type !== "text") {
      return NextResponse.json(
        { error: "No text in plan response" },
        { status: 500 }
      )
    }

    let plan: WeeklyPlan
    try {
      plan = extractJSON<WeeklyPlan>(planText.text)
    } catch {
      return NextResponse.json(
        { error: "Failed to parse plan JSON", raw: planText.text },
        { status: 500 }
      )
    }

    // Stage 2: Write posts based on plan
    const writeResponse = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: buildWriteSystemPrompt(cafeDeHoek),
      messages: [
        {
          role: "user",
          content: buildWriteUserPrompt(cafeDeHoek, plan.days),
        },
      ],
    })

    const writeText = writeResponse.content.find((b) => b.type === "text")
    if (!writeText || writeText.type !== "text") {
      return NextResponse.json(
        { error: "No text in write response" },
        { status: 500 }
      )
    }

    let rawPosts: { posts: Omit<DayPosts, "warnings">[] }
    try {
      rawPosts = extractJSON<{ posts: Omit<DayPosts, "warnings">[] }>(writeText.text)
    } catch {
      return NextResponse.json(
        { error: "Failed to parse posts JSON", raw: writeText.text },
        { status: 500 }
      )
    }

    // Validate posts against hard constraints
    const validatedPosts = validatePosts(rawPosts.posts, cafeDeHoek.bannedPhrases)

    const result: GenerationResult = {
      client: {
        name: cafeDeHoek.name,
        type: cafeDeHoek.type,
        location: cafeDeHoek.location,
      },
      plan: plan.days,
      posts: validatedPosts,
      metadata: {
        generatedAt: new Date().toISOString(),
        model: MODEL,
        planInputTokens: planResponse.usage.input_tokens,
        planOutputTokens: planResponse.usage.output_tokens,
        postsInputTokens: writeResponse.usage.input_tokens,
        postsOutputTokens: writeResponse.usage.output_tokens,
      },
    }

    return NextResponse.json(result)
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors (or only pre-existing unrelated ones).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/generate-posts/route.ts
git commit -m "feat: add /api/generate-posts route with two-stage pipeline and validation"
```

---

## Task 6: Build the preview page

**Files:**
- Create: `src/app/admin/generate-preview/page.tsx`

- [ ] **Step 1: Create the preview page**

Create `src/app/admin/generate-preview/page.tsx` (inline styles to match rest of `/admin`):

```tsx
"use client"

import { useState } from "react"
import type { GenerationResult } from "@/lib/ai/types"

export default function GeneratePreviewPage() {
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch("/api/generate-posts")
      const data = await response.json()

      if (!response.ok) {
        setError(data.error || "Generation failed")
        return
      }

      setResult(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ maxWidth: "800px", padding: "32px" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "8px" }}>
        Post Generation Preview
      </h1>
      <p style={{ color: "#666", marginBottom: "24px" }}>
        Generate a week of posts for Café de Hoek. Takes ~15–30 seconds (two AI
        calls).
      </p>

      <button
        onClick={handleGenerate}
        disabled={loading}
        style={{
          padding: "8px 16px",
          backgroundColor: loading ? "#999" : "#1a1a1a",
          color: "#fff",
          border: "none",
          borderRadius: "4px",
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Generating…" : "Generate Week"}
      </button>

      {error && (
        <div
          style={{
            marginTop: "24px",
            padding: "16px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "4px",
            color: "#991b1b",
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: "32px" }}>
          {/* Metadata */}
          <p style={{ fontSize: "12px", color: "#888", marginBottom: "24px" }}>
            Generated at{" "}
            {new Date(result.metadata.generatedAt).toLocaleString()} · Model:{" "}
            {result.metadata.model} · Tokens:{" "}
            {result.metadata.planInputTokens +
              result.metadata.planOutputTokens +
              result.metadata.postsInputTokens +
              result.metadata.postsOutputTokens}{" "}
            total
          </p>

          {/* Posts by day */}
          {result.posts.map((post) => {
            const dayPlan = result.plan.find((p) => p.day === post.day)
            return (
              <div
                key={post.day}
                style={{
                  border: "1px solid #eee",
                  borderRadius: "8px",
                  padding: "24px",
                  marginBottom: "24px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    marginBottom: "16px",
                  }}
                >
                  <h2 style={{ fontSize: "18px", fontWeight: 600 }}>
                    {post.day}
                  </h2>
                  {dayPlan && (
                    <span style={{ fontSize: "12px", color: "#888" }}>
                      {dayPlan.theme} · {dayPlan.angle}
                    </span>
                  )}
                </div>

                {/* Instagram */}
                <div style={{ marginBottom: "12px" }}>
                  <h3
                    style={{
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "#be185d",
                      marginBottom: "4px",
                    }}
                  >
                    Instagram
                  </h3>
                  <p
                    style={{
                      whiteSpace: "pre-wrap",
                      backgroundColor: "#f9fafb",
                      padding: "12px",
                      borderRadius: "4px",
                      fontSize: "14px",
                    }}
                  >
                    {post.instagramCaption}
                  </p>
                </div>

                {/* Facebook */}
                <div style={{ marginBottom: "12px" }}>
                  <h3
                    style={{
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "#1d4ed8",
                      marginBottom: "4px",
                    }}
                  >
                    Facebook
                  </h3>
                  <p
                    style={{
                      whiteSpace: "pre-wrap",
                      backgroundColor: "#f9fafb",
                      padding: "12px",
                      borderRadius: "4px",
                      fontSize: "14px",
                    }}
                  >
                    {post.facebookPost}
                  </p>
                </div>

                {/* Warnings */}
                {post.warnings.length > 0 && (
                  <div
                    style={{
                      backgroundColor: "#fffbeb",
                      border: "1px solid #fde68a",
                      borderRadius: "4px",
                      padding: "12px",
                      marginBottom: "12px",
                    }}
                  >
                    <strong style={{ fontSize: "12px", color: "#92400e" }}>
                      Warnings:
                    </strong>
                    <ul style={{ margin: "4px 0 0 16px", fontSize: "12px", color: "#92400e" }}>
                      {post.warnings.map((w, i) => (
                        <li key={i}>
                          [{w.platform}] {w.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Reasoning + Summary */}
                <div
                  style={{
                    borderTop: "1px solid #eee",
                    paddingTop: "12px",
                    fontSize: "13px",
                    color: "#666",
                  }}
                >
                  <p style={{ marginBottom: "4px" }}>
                    <strong>Why:</strong> {post.reasoning}
                  </p>
                  <p>
                    <strong>EN:</strong> {post.englishSummary}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Add link to admin page**

In `src/app/admin/page.tsx`, add a link to the generate preview below the existing "Manage clients" link. Add this inside the closing `<div style={{ marginTop: "32px" }}>`:

```tsx
<Link
  href="/admin/generate-preview"
  style={{
    color: "#1a1a1a",
    textDecoration: "underline",
    fontSize: "14px",
    marginLeft: "16px",
  }}
>
  Generate posts preview →
</Link>
```

- [ ] **Step 3: Verify the dev server loads the page**

Run:
```bash
npm run dev
```

Visit `http://localhost:3000/admin/generate-preview`. Expected: page loads with a "Generate Week" button.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/generate-preview/page.tsx src/app/admin/page.tsx
git commit -m "feat: add post generation preview page"
```

---

## Task 7: End-to-end test

**Files:** None new — this is a manual verification task.

- [ ] **Step 1: Run the generation**

With `npm run dev` running, visit `http://localhost:3000/admin/generate-preview` and click "Generate Week".

Expected: After 15–30 seconds, you see 7 days of posts with Instagram and Facebook versions, reasoning, English summaries, and any constraint warnings (yellow boxes).

- [ ] **Step 2: Evaluate the output**

Check against the "feels human" criteria:
- **Tone:** Does it sound like Marloes (warm, direct, friend-like)?
- **Variety:** Are angles different across the week?
- **Platform fit:** IG feels like IG, FB feels like FB?
- **Banned phrases:** None of the banned phrases appear? (If they do, the warnings section catches them automatically.)
- **Sentence length:** Any warnings for sentences over 15 words?
- **Language:** Dutch, with short natural sentences?

- [ ] **Step 3: Check the raw JSON**

Visit `http://localhost:3000/api/generate-posts` directly in the browser. Verify the JSON structure matches the spec (plan + posts + metadata).

- [ ] **Step 4: Note any issues**

If the output has problems (too corporate, repetitive angles, banned phrases slipping through), note them. We'll iterate on prompts in the next session.

- [ ] **Step 5: Commit any final fixes and push**

```bash
git push -u origin feature/post-generation-prototype
```

---

## Summary

| Task | What it does | ~Time |
|------|-------------|-------|
| 1 | Install SDK + env setup | 2 min |
| 2 | Types + client profile | 3 min |
| 3 | Anthropic client + prompts | 5 min |
| 4 | JSON extraction + post validation | 3 min |
| 5 | API route (the core logic) | 5 min |
| 6 | Preview page (inline styles) | 5 min |
| 7 | Manual end-to-end test | 5 min |
