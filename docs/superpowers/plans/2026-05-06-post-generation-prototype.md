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

export interface DayPosts {
  day: string
  instagramCaption: string
  facebookPost: string
  reasoning: string
  englishSummary: string
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

## Task 4: Build the API route

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
      plan = JSON.parse(planText.text)
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

    let postsData: { posts: DayPosts[] }
    try {
      postsData = JSON.parse(writeText.text)
    } catch {
      return NextResponse.json(
        { error: "Failed to parse posts JSON", raw: writeText.text },
        { status: 500 }
      )
    }

    const result: GenerationResult = {
      client: {
        name: cafeDeHoek.name,
        type: cafeDeHoek.type,
        location: cafeDeHoek.location,
      },
      plan: plan.days,
      posts: postsData.posts,
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
git commit -m "feat: add /api/generate-posts route with two-stage pipeline"
```

---

## Task 5: Build the preview page

**Files:**
- Create: `src/app/admin/generate-preview/page.tsx`

- [ ] **Step 1: Create the preview page**

Create `src/app/admin/generate-preview/page.tsx`:

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
    <main className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-2">Post Generation Preview</h1>
      <p className="text-gray-600 mb-6">
        Generate a week of posts for Café de Hoek. Takes ~15–30 seconds (two AI calls).
      </p>

      <button
        onClick={handleGenerate}
        disabled={loading}
        className="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Generating…" : "Generate Week"}
      </button>

      {error && (
        <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded text-red-800">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-8 space-y-8">
          {/* Metadata */}
          <div className="text-sm text-gray-500">
            Generated at {new Date(result.metadata.generatedAt).toLocaleString()} ·
            Model: {result.metadata.model} ·
            Tokens: {result.metadata.planInputTokens + result.metadata.planOutputTokens + result.metadata.postsInputTokens + result.metadata.postsOutputTokens} total
          </div>

          {/* Posts by day */}
          {result.posts.map((post) => {
            const dayPlan = result.plan.find((p) => p.day === post.day)
            return (
              <div key={post.day} className="border rounded-lg p-6 space-y-4">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-lg font-semibold">{post.day}</h2>
                  {dayPlan && (
                    <span className="text-sm text-gray-500">
                      {dayPlan.theme} · {dayPlan.angle}
                    </span>
                  )}
                </div>

                {/* Instagram */}
                <div className="space-y-1">
                  <h3 className="text-sm font-medium text-pink-700">Instagram</h3>
                  <p className="whitespace-pre-wrap bg-gray-50 p-3 rounded text-sm">
                    {post.instagramCaption}
                  </p>
                </div>

                {/* Facebook */}
                <div className="space-y-1">
                  <h3 className="text-sm font-medium text-blue-700">Facebook</h3>
                  <p className="whitespace-pre-wrap bg-gray-50 p-3 rounded text-sm">
                    {post.facebookPost}
                  </p>
                </div>

                {/* Reasoning + Summary */}
                <div className="text-sm text-gray-600 space-y-1 border-t pt-3">
                  <p><span className="font-medium">Why:</span> {post.reasoning}</p>
                  <p><span className="font-medium">EN:</span> {post.englishSummary}</p>
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

## Task 6: End-to-end test

**Files:** None new — this is a manual verification task.

- [ ] **Step 1: Run the generation**

With `npm run dev` running, visit `http://localhost:3000/admin/generate-preview` and click "Generate Week".

Expected: After 15–30 seconds, you see 7 days of posts with Instagram and Facebook versions, reasoning, and English summaries.

- [ ] **Step 2: Evaluate the output**

Check against the "feels human" criteria:
- **Tone:** Does it sound like Marloes (warm, direct, friend-like)?
- **Variety:** Are angles different across the week?
- **Platform fit:** IG feels like IG, FB feels like FB?
- **Banned phrases:** None of the banned phrases appear?
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
| 4 | API route (the core logic) | 5 min |
| 5 | Preview page | 5 min |
| 6 | Manual end-to-end test | 5 min |
