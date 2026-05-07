# Photo-Grounded Post Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the post generation pipeline so Claude can see client photos and write posts grounded in what it sees — combining visual contents, mood, and brand context.

**Architecture:** Photo analysis runs once at upload time (persisted to DB). The two-stage generation pipeline (plan → write) consumes stored analysis + raw images. Preview page renders photo days as side-by-side platform previews.

**Tech Stack:** Next.js, Drizzle ORM (SQLite), Anthropic Claude SDK (vision), Vercel Blob, TypeScript

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/db/schema.ts` | Modify | Add `photos` table |
| `src/lib/ai/types.ts` | Modify | Add `PhotoAnalysis`, `PhotoRow`, update `DayPlan`, `DayPosts`, `GenerationResult` |
| `src/lib/photos/analyze.ts` | Create | Photo analysis function (Claude vision) |
| `src/lib/photos/upload.ts` | Create | Upload validation + Vercel Blob storage |
| `src/lib/ai/prompts.ts` | Modify | Add photo-aware plan and write prompts |
| `src/app/api/photos/upload/route.ts` | Create | Photo upload endpoint |
| `src/app/api/photos/[id]/analyze/route.ts` | Create | Manual retry analysis endpoint |
| `src/app/api/generate-posts/route.ts` | Modify | Photo-aware pipeline |
| `src/app/admin/generate-preview/page.tsx` | Modify | Side-by-side previews, analysis panel |
| `src/lib/ai/validate-posts.ts` | Modify | Update input/output types to omit photo fields |
| `scripts/seed-cafe-de-hoek.ts` | Create | Seed script to create Café de Hoek client row with stable ID |
| `src/data/clients/cafe-de-hoek.ts` | Modify | Add stable CLIENT_ID constant |

---

### Task 0: Create feature branch

- [ ] **Step 1: Create and switch to feature branch**

```bash
git checkout -b feat/photo-grounded-generation
```

- [ ] **Step 2: Verify branch**

```bash
git branch --show-current
```

Expected: `feat/photo-grounded-generation`

---

### Task 1: Install @vercel/blob dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
npm install @vercel/blob
```

- [ ] **Step 2: Verify it installed**

```bash
npm ls @vercel/blob
```

Expected: Shows `@vercel/blob@<version>` without errors.

- [ ] **Step 3: Add BLOB_READ_WRITE_TOKEN to .env.example**

Add the new environment variable to `.env.example` so developers know it's needed:

```
# Vercel Blob storage
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxxxxxxxxx
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add @vercel/blob dependency for photo storage"
```

---

### Task 2: Add PhotoAnalysis type and update existing types

**Files:**
- Modify: `src/lib/ai/types.ts`

- [ ] **Step 1: Add PhotoAnalysis interface and PhotoRow type**

Add these types at the end of `src/lib/ai/types.ts`:

```typescript
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
```

- [ ] **Step 2: Update DayPlan to include photoId**

Change the existing `DayPlan` interface in `src/lib/ai/types.ts`:

```typescript
export interface DayPlan {
  day: string
  theme: string
  angle: string
  platformDifferences: string
  toneNote: string
  photoId: string | null
}
```

- [ ] **Step 3: Update DayPosts to include photo fields**

Change the existing `DayPosts` interface in `src/lib/ai/types.ts`:

```typescript
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
```

- [ ] **Step 4: Update GenerationResult metadata**

Add photo token tracking to the `GenerationResult` metadata. Change the metadata type inside the existing `GenerationResult` interface:

```typescript
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
```

- [ ] **Step 5: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/types.ts
git commit -m "feat: add photo-related types and update DayPlan/DayPosts for photo support"
```

---

### Task 3: Add photos table to database schema

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add the photos table**

Add this after the `clients` table definition in `src/db/schema.ts`, around line 55:

```typescript
// ──────────────────────────────────────────────
// photos — client photos for post generation
// ──────────────────────────────────────────────
export const photos = sqliteTable("photos", {
  id: text("id")
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  clientId: text("clientId")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  blobUrl: text("blobUrl").notNull(),
  originalFilename: text("originalFilename").notNull(),
  mimeType: text("mimeType").notNull(),
  sizeBytes: integer("sizeBytes").notNull(),
  analysis: text("analysis", { mode: "json" }).$type<PhotoAnalysis>(),
  analyzedAt: integer("analyzedAt", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
```

- [ ] **Step 2: Add the PhotoAnalysis import**

Add the import at the top of `src/db/schema.ts`:

```typescript
import type { PhotoAnalysis } from "@/lib/ai/types"
```

- [ ] **Step 3: Generate the migration**

```bash
npm run db:generate
```

Expected: Creates a new migration SQL file in `src/db/migrations/`.

- [ ] **Step 4: Run the migration**

```bash
npm run db:migrate
```

Expected: Migration applies successfully.

- [ ] **Step 5: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -m "feat: add photos table with typed JSON analysis column"
```

---

### Task 4: Create photo upload utility

**Files:**
- Create: `src/lib/photos/upload.ts`

- [ ] **Step 1: Write the upload utility**

Create `src/lib/photos/upload.ts`:

```typescript
import { put } from "@vercel/blob"

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
])

export interface UploadValidationError {
  field: string
  message: string
}

export function validatePhotoFile(
  file: File
): UploadValidationError | null {
  if (!ALLOWED_TYPES.has(file.type)) {
    return {
      field: "file",
      message: `Invalid file type: ${file.type}. Accepted: JPEG, PNG, WebP.`,
    }
  }
  if (file.size > MAX_FILE_SIZE) {
    return {
      field: "file",
      message: `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum: 5MB.`,
    }
  }
  return null
}

export async function uploadPhotoToBlob(
  file: File,
  clientId: string
): Promise<{ url: string }> {
  const blob = await put(
    `photos/${clientId}/${Date.now()}-${file.name}`,
    file,
    { access: "public" }
  )
  return { url: blob.url }
}
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/photos/upload.ts
git commit -m "feat: add photo upload validation and Vercel Blob storage utility"
```

---

### Task 5: Create photo analysis function

**Files:**
- Create: `src/lib/photos/analyze.ts`

- [ ] **Step 1: Write the analysis function**

Create `src/lib/photos/analyze.ts`:

```typescript
import { getAnthropicClient } from "@/lib/ai/client"
import { extractJSON } from "@/lib/ai/extract-json"
import type { PhotoAnalysis } from "@/lib/ai/types"

const MODEL = "claude-sonnet-4-6"

const ANALYSIS_SYSTEM_PROMPT = `You are a photo analyst for a social media management platform. You analyze photos uploaded by small business clients to help generate social media posts.

Your job: look at the photo and produce a structured analysis that a content writer can use to write authentic, grounded social media posts.

Focus on:
- What's literally in the photo (subjects, objects, people, food, setting)
- The mood and atmosphere the photo conveys
- Any seasonal cues (weather, decorations, lighting, clothing)
- The physical setting (indoor/outdoor, type of space)
- How this photo could connect to a small business brand (angles for posts)
- A rich visual description capturing details a writer might reference

Respond with valid JSON only. No markdown, no explanation outside the JSON.`

function buildAnalysisUserPrompt(): string {
  return `Analyze this photo and respond with this exact JSON structure:
{
  "subjects": ["list", "of", "things", "in", "the", "photo"],
  "mood": "one or two words describing the emotional tone",
  "season": "season if detectable, or null",
  "setting": "where the photo was taken",
  "brandAngles": ["angle1", "angle2", "angle3"],
  "visualDetails": "One paragraph with rich visual description — colors, textures, composition, lighting, anything a writer could reference."
}`
}

export async function analyzePhoto(
  blobUrl: string
): Promise<PhotoAnalysis> {
  const client = getAnthropicClient()

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: ANALYSIS_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "url",
              url: blobUrl,
            },
          },
          {
            type: "text",
            text: buildAnalysisUserPrompt(),
          },
        ],
      },
    ],
  })

  const textBlock = response.content.find((b) => b.type === "text")
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in analysis response")
  }

  return extractJSON<PhotoAnalysis>(textBlock.text)
}
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/photos/analyze.ts
git commit -m "feat: add photo analysis function using Claude vision API"
```

---

### Task 6: Create photo upload API endpoint

**Files:**
- Create: `src/app/api/photos/upload/route.ts`

- [ ] **Step 1: Write the upload route handler**

Create `src/app/api/photos/upload/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { photos } from "@/db/schema"
import { eq } from "drizzle-orm"
import { clients } from "@/db/schema"
import { validatePhotoFile, uploadPhotoToBlob } from "@/lib/photos/upload"
import { analyzePhoto } from "@/lib/photos/analyze"
import type { PhotoRow, UploadResult } from "@/lib/ai/types"

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file")
    const clientId = formData.get("clientId")

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing file in form data" },
        { status: 400 }
      )
    }

    if (!clientId || typeof clientId !== "string") {
      return NextResponse.json(
        { error: "Missing clientId in form data" },
        { status: 400 }
      )
    }

    // Verify client exists
    const client = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId))
      .get()

    if (!client) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 }
      )
    }

    // Validate file
    const validationError = validatePhotoFile(file)
    if (validationError) {
      return NextResponse.json(
        { error: validationError.message },
        { status: 400 }
      )
    }

    // Upload to Vercel Blob
    const { url } = await uploadPhotoToBlob(file, clientId)

    // Create DB row
    const [photoRow] = await db
      .insert(photos)
      .values({
        clientId,
        blobUrl: url,
        originalFilename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      })
      .returning()

    // Attempt analysis (does not roll back upload on failure)
    let analysisStatus: "succeeded" | "failed" = "failed"
    let analysisError: string | undefined

    try {
      const analysis = await analyzePhoto(url)
      const now = new Date()

      await db
        .update(photos)
        .set({ analysis, analyzedAt: now })
        .where(eq(photos.id, photoRow.id))

      photoRow.analysis = analysis
      photoRow.analyzedAt = now
      analysisStatus = "succeeded"
    } catch (err: unknown) {
      analysisError =
        err instanceof Error ? err.message : "Analysis failed"
    }

    const result: UploadResult = {
      photo: photoRow as PhotoRow,
      analysisStatus,
      ...(analysisError && { error: analysisError }),
    }

    return NextResponse.json(result)
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Upload failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/photos/upload/route.ts
git commit -m "feat: add photo upload endpoint with Blob storage and auto-analysis"
```

---

### Task 7: Create analysis retry API endpoint

**Files:**
- Create: `src/app/api/photos/[id]/analyze/route.ts`

- [ ] **Step 1: Write the retry route handler**

Create `src/app/api/photos/[id]/analyze/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { photos } from "@/db/schema"
import { eq } from "drizzle-orm"
import { analyzePhoto } from "@/lib/photos/analyze"

export const maxDuration = 60

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const photo = await db
      .select()
      .from(photos)
      .where(eq(photos.id, id))
      .get()

    if (!photo) {
      return NextResponse.json(
        { error: "Photo not found" },
        { status: 404 }
      )
    }

    const analysis = await analyzePhoto(photo.blobUrl)
    const now = new Date()

    await db
      .update(photos)
      .set({ analysis, analyzedAt: now })
      .where(eq(photos.id, id))

    return NextResponse.json({
      analysisStatus: "succeeded" as const,
      analysis,
      analyzedAt: now.toISOString(),
    })
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Analysis failed"
    return NextResponse.json(
      { analysisStatus: "failed" as const, error: message },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/photos/\[id\]/analyze/route.ts
git commit -m "feat: add manual photo analysis retry endpoint"
```

---

### Task 8: Update prompts for photo-aware plan and write stages

**Files:**
- Modify: `src/lib/ai/prompts.ts`

- [ ] **Step 1: Add the AnalyzedPhoto import**

Add to the imports at the top of `src/lib/ai/prompts.ts`:

```typescript
import type { ClientProfile, DayPlan, AnalyzedPhoto } from "./types"
```

- [ ] **Step 2: Update buildPlanSystemPrompt to accept photos**

Replace the existing `buildPlanSystemPrompt` function with:

```typescript
export function buildPlanSystemPrompt(photoCount: number): string {
  const photoRules =
    photoCount > 0
      ? `\n\nPhoto rules:
- You have ${photoCount} photo(s) available this week. Assign each photo to a day by setting photoId to the photo's ID. Days without photos get photoId: null.
- HARD RULE: No two photo days may be back-to-back (adjacent). Spread them across the week.
- Match photo mood and content to the day's theme when possible.
- Every available photo must be assigned to exactly one day.`
      : ""

  return `You are a social media content planner for small Dutch businesses. Your job is to plan a week of social media posts that feel authentic — as if the business owner wrote them.

You will receive a client profile. Based on it, create a 7-day content plan (Tuesday through Monday).

Rules:
- No two days may have the same angle. Same topic is fine if the angle is different (e.g. coffee-as-morning-ritual vs coffee-as-afternoon-pickup).
- Mix content types across the week: product highlights, atmosphere/vibe, community moments, behind-the-scenes, seasonal.
- Monday posts acknowledge the café is closed (anticipation-style: "see you tomorrow", a recipe tip, or a personal moment).
- Each day must have a clear theme, a distinct angle, platform differences, and a tone note.${photoRules}

Respond with valid JSON only. No markdown, no explanation outside the JSON.`
}
```

- [ ] **Step 3: Update buildPlanUserPrompt to include photo analysis**

Replace the existing `buildPlanUserPrompt` function with:

```typescript
export function buildPlanUserPrompt(
  client: ClientProfile,
  photos: AnalyzedPhoto[]
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

  return `Create a 7-day content plan for this client:

Business: ${client.name}
Type: ${client.type}
Location: ${client.location}
Hours: ${client.hours}
Vibe: ${client.vibe}
Menu highlights: ${client.menuHighlights.join(", ")}
Owner persona: ${client.ownerPersona.name}, ${client.ownerPersona.age}. ${client.ownerPersona.style}
Target customers: ${client.targetCustomers.join(", ")}
Platforms: ${client.platforms.join(" + ")}${photoSection}

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

Include all 7 days: Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday, Monday.`
}
```

- [ ] **Step 4: Update buildWriteUserPrompt to include photo context**

Replace the existing `buildWriteUserPrompt` function with:

```typescript
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
- Menu: ${client.menuHighlights.join(", ")}
- Customers: ${client.targetCustomers.join(", ")}
- Closed Monday (Monday post = anticipation or personal content)

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

Include all 7 days.`
}
```

- [ ] **Step 5: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/prompts.ts
git commit -m "feat: update plan and write prompts for photo-aware generation"
```

---

### Task 9: Update the generation pipeline to use photos

**Files:**
- Modify: `src/app/api/generate-posts/route.ts`

- [ ] **Step 1: Replace the entire route handler**

Replace the full contents of `src/app/api/generate-posts/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { db } from "@/db"
import { photos } from "@/db/schema"
import { eq } from "drizzle-orm"
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
import type {
  WeeklyPlan,
  DayPosts,
  GenerationResult,
  AnalyzedPhoto,
  PhotoAnalysis,
} from "@/lib/ai/types"

const MODEL = "claude-sonnet-4-6"
const CAFE_DE_HOEK_CLIENT_ID = "cafe-de-hoek-placeholder"

export const maxDuration = 60

export async function POST() {
  try {
    const anthropic = getAnthropicClient()

    // Load analyzed photos for this client
    const photoRows = await db
      .select()
      .from(photos)
      .where(eq(photos.clientId, CAFE_DE_HOEK_CLIENT_ID))

    // Filter to only analyzed photos — unanalyzed ones are skipped
    const unanalyzedCount = photoRows.filter((p) => p.analysis === null).length
    if (unanalyzedCount > 0) {
      console.warn(
        `[generate-posts] Skipping ${unanalyzedCount} unanalyzed photo(s) for client ${CAFE_DE_HOEK_CLIENT_ID}`
      )
    }

    const analyzedPhotos: AnalyzedPhoto[] = photoRows
      .filter((p): p is typeof p & { analysis: PhotoAnalysis } =>
        p.analysis !== null
      )
      .map((p) => ({
        id: p.id,
        blobUrl: p.blobUrl,
        analysis: p.analysis,
      }))

    // Stage 1: Generate content plan (text only — no vision cost)
    const planResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: buildPlanSystemPrompt(analyzedPhotos.length),
      messages: [
        {
          role: "user",
          content: buildPlanUserPrompt(cafeDeHoek, analyzedPhotos),
        },
      ],
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

    // Build photo map for write stage
    const photoMap = new Map(analyzedPhotos.map((p) => [p.id, p]))

    // Stage 2: Write posts based on plan
    // Build content array — include photos for photo days via vision API
    const photoDays = plan.days.filter(
      (d) => d.photoId && photoMap.has(d.photoId)
    )
    const writeContent: Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "url"; url: string } }
    > = []

    // Add photos for photo days so Claude can see them
    for (const day of photoDays) {
      const photo = photoMap.get(day.photoId!)!
      writeContent.push({
        type: "image",
        source: { type: "url", url: photo.blobUrl },
      })
      writeContent.push({
        type: "text",
        text: `[Photo for ${day.day} — ID: ${photo.id}]`,
      })
    }

    // Add the main write prompt
    writeContent.push({
      type: "text",
      text: buildWriteUserPrompt(cafeDeHoek, plan.days, analyzedPhotos),
    })

    const writeResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: buildWriteSystemPrompt(cafeDeHoek),
      messages: [{ role: "user", content: writeContent }],
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
      rawPosts = extractJSON<{ posts: Omit<DayPosts, "warnings">[] }>(
        writeText.text
      )
    } catch {
      return NextResponse.json(
        { error: "Failed to parse posts JSON", raw: writeText.text },
        { status: 500 }
      )
    }

    // Validate posts against hard constraints
    const validatedPosts = validatePosts(
      rawPosts.posts,
      cafeDeHoek.bannedPhrases
    )

    // Attach photo info to each post based on the plan
    const postsWithPhotos: DayPosts[] = validatedPosts.map((post) => {
      const dayPlan = plan.days.find((d) => d.day === post.day)
      const photoId = dayPlan?.photoId ?? null
      const photo = photoId ? photoMap.get(photoId) : null
      return {
        ...post,
        photoId,
        photoUrl: photo?.blobUrl ?? null,
      }
    })

    const result: GenerationResult = {
      client: {
        name: cafeDeHoek.name,
        type: cafeDeHoek.type,
        location: cafeDeHoek.location,
      },
      plan: plan.days,
      posts: postsWithPhotos,
      metadata: {
        generatedAt: new Date().toISOString(),
        model: MODEL,
        planInputTokens: planResponse.usage.input_tokens,
        planOutputTokens: planResponse.usage.output_tokens,
        postsInputTokens: writeResponse.usage.input_tokens,
        postsOutputTokens: writeResponse.usage.output_tokens,
        photosUsed: photoDays.length,
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

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/generate-posts/route.ts
git commit -m "feat: update generation pipeline to use photo analysis and vision"
```

---

### Task 10: Update validate-posts to handle photo fields

**Files:**
- Modify: `src/lib/ai/validate-posts.ts`

The existing `validatePosts` function uses `Omit<DayPosts, "warnings">` as input. Since we added `photoId` and `photoUrl` to `DayPosts`, the Omit type now expects those fields too. But Claude's raw JSON output won't include them — they're attached after validation in the route handler.

- [ ] **Step 1: Update the input type to also omit photo fields**

Change the function signature in `src/lib/ai/validate-posts.ts` from:

```typescript
export function validatePosts(
  posts: Omit<DayPosts, "warnings">[],
  bannedPhrases: string[]
): DayPosts[] {
```

To:

```typescript
export function validatePosts(
  posts: Omit<DayPosts, "warnings" | "photoId" | "photoUrl">[],
  bannedPhrases: string[]
): Omit<DayPosts, "photoId" | "photoUrl">[] {
```

Also update the return type annotation of the `map` callback. The existing code at the bottom of the function (line 64 in the current file) reads:

```typescript
    return { ...post, warnings }
```

This line does not need to change — the spread works correctly. But the overall function return type changed (from `DayPosts[]` to `Omit<DayPosts, "photoId" | "photoUrl">[]`), so confirm the full function signature now reads:

```typescript
export function validatePosts(
  posts: Omit<DayPosts, "warnings" | "photoId" | "photoUrl">[],
  bannedPhrases: string[]
): Omit<DayPosts, "photoId" | "photoUrl">[] {
  return posts.map((post) => {
    const warnings: PostWarning[] = []
    // ... existing validation logic unchanged ...
    return { ...post, warnings }
  })
}
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/validate-posts.ts
git commit -m "fix: update validatePosts types to account for new photo fields"
```

---

### Task 11: Seed Café de Hoek client with stable ID

The pipeline needs a real `clients.id` to query photos. Create a seed script (following the existing `seed-admin.ts` pattern) that ensures a Café de Hoek client row exists with a deterministic ID.

**Files:**
- Create: `scripts/seed-cafe-de-hoek.ts`
- Modify: `src/data/clients/cafe-de-hoek.ts`
- Modify: `src/app/api/generate-posts/route.ts`
- Modify: `package.json`

- [ ] **Step 1: Add a stable client ID constant to the client data file**

Add this constant at the top of `src/data/clients/cafe-de-hoek.ts`, before the `cafeDeHoek` export:

```typescript
/** Stable ID used by the seed script and the generation pipeline. */
export const CAFE_DE_HOEK_CLIENT_ID = "cafe-de-hoek-00000000"
```

- [ ] **Step 2: Create the seed script**

Create `scripts/seed-cafe-de-hoek.ts`:

```typescript
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { users, clients } from "../src/db/schema"
import { eq } from "drizzle-orm"
import { CAFE_DE_HOEK_CLIENT_ID } from "../src/data/clients/cafe-de-hoek"

const sqlite = new Database("sqlite.db")
const db = drizzle(sqlite)

async function seed() {
  // Check if the client already exists
  const existing = await db
    .select()
    .from(clients)
    .where(eq(clients.id, CAFE_DE_HOEK_CLIENT_ID))
    .get()

  if (existing) {
    console.log(
      `Café de Hoek client already exists (${CAFE_DE_HOEK_CLIENT_ID}). Skipping.`
    )
    sqlite.close()
    return
  }

  // Find the admin user to attach the client to
  const admin = await db
    .select()
    .from(users)
    .where(eq(users.role, "admin"))
    .get()

  if (!admin) {
    console.error("Error: No admin user found. Run seed:admin first.")
    sqlite.close()
    process.exit(1)
  }

  // Check if admin already has a client row
  const existingClientForAdmin = await db
    .select()
    .from(clients)
    .where(eq(clients.userId, admin.id))
    .get()

  if (existingClientForAdmin) {
    console.log(
      `Admin already has a client row (${existingClientForAdmin.id}). ` +
      `Update its ID to ${CAFE_DE_HOEK_CLIENT_ID} manually if needed, ` +
      `or delete and re-run.`
    )
    sqlite.close()
    return
  }

  await db.insert(clients).values({
    id: CAFE_DE_HOEK_CLIENT_ID,
    userId: admin.id,
    businessName: "Café de Hoek",
    location: "Arnhem, Netherlands",
    industry: "Café / lunchroom",
    businessType: "Café/lunchroom (no dinner service)",
    productsServices:
      "Homemade appeltaart, daily soups, fresh sandwiches, specialty coffee, fresh-pressed juices",
  })

  console.log(
    `Café de Hoek client created with ID: ${CAFE_DE_HOEK_CLIENT_ID}`
  )
  sqlite.close()
}

seed().catch((err) => {
  console.error("Seed script failed:", err)
  sqlite.close()
  process.exit(1)
})
```

- [ ] **Step 3: Add the seed script to package.json**

Add to the `scripts` section of `package.json`:

```json
"seed:cafe": "tsx --env-file=.env.local scripts/seed-cafe-de-hoek.ts"
```

- [ ] **Step 4: Update the pipeline to use the imported constant**

In `src/app/api/generate-posts/route.ts`, replace the hardcoded placeholder:

Replace:
```typescript
const CAFE_DE_HOEK_CLIENT_ID = "cafe-de-hoek-placeholder"
```

With:
```typescript
import { CAFE_DE_HOEK_CLIENT_ID } from "@/data/clients/cafe-de-hoek"
```

Remove the old constant line entirely — the import replaces it.

- [ ] **Step 5: Run the seed script**

```bash
npm run seed:cafe
```

Expected: `Café de Hoek client created with ID: cafe-de-hoek-00000000`

- [ ] **Step 6: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add scripts/seed-cafe-de-hoek.ts src/data/clients/cafe-de-hoek.ts src/app/api/generate-posts/route.ts package.json
git commit -m "feat: add Café de Hoek seed script with stable client ID"
```

---

### Task 12: Include photo analysis in generation result

The preview page needs analysis data to show the collapsible "What Claude saw" panel. The pipeline already has the analysis objects — pass them through in the result.

**Files:**
- Modify: `src/lib/ai/types.ts`
- Modify: `src/app/api/generate-posts/route.ts`

- [ ] **Step 1: Add photoAnalyses to GenerationResult**

In `src/lib/ai/types.ts`, update the `GenerationResult` interface to include a photo analyses map:

```typescript
export interface GenerationResult {
  client: { name: string; type: string; location: string }
  plan: DayPlan[]
  posts: DayPosts[]
  photoAnalyses: Record<string, PhotoAnalysis>
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
```

- [ ] **Step 2: Populate photoAnalyses in the pipeline**

In `src/app/api/generate-posts/route.ts`, add the `photoAnalyses` field when building the result object. Find the `const result: GenerationResult = {` block and add after the `posts` line:

```typescript
      photoAnalyses: Object.fromEntries(
        analyzedPhotos.map((p) => [p.id, p.analysis])
      ),
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/types.ts src/app/api/generate-posts/route.ts
git commit -m "feat: include photo analyses in generation result for preview display"
```

---

### Task 13: Update the preview page for photo posts

**Files:**
- Modify: `src/app/admin/generate-preview/page.tsx`

- [ ] **Step 1: Add the PhotoAnalysisPanel component**

Add this component inside `src/app/admin/generate-preview/page.tsx`, between the imports and the `GeneratePreviewPage` function:

```typescript
function PhotoAnalysisPanel({ analysis }: { analysis: PhotoAnalysis }) {
  const [open, setOpen] = useState(false)

  return (
    <div
      style={{
        borderTop: "1px solid #eee",
        paddingTop: "12px",
        marginTop: "12px",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: "12px",
          color: "#888",
          padding: 0,
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        <span style={{ fontSize: "10px" }}>{open ? "▼" : "▶"}</span>
        What Claude saw in this photo
      </button>
      {open && (
        <div
          style={{
            marginTop: "8px",
            fontSize: "12px",
            color: "#666",
            backgroundColor: "#f9fafb",
            padding: "12px",
            borderRadius: "4px",
          }}
        >
          <p style={{ marginBottom: "6px" }}>
            <strong>Subjects:</strong> {analysis.subjects.join(", ")}
          </p>
          <p style={{ marginBottom: "6px" }}>
            <strong>Mood:</strong> {analysis.mood}
          </p>
          {analysis.season && (
            <p style={{ marginBottom: "6px" }}>
              <strong>Season:</strong> {analysis.season}
            </p>
          )}
          <p style={{ marginBottom: "6px" }}>
            <strong>Setting:</strong> {analysis.setting}
          </p>
          <p style={{ marginBottom: "6px" }}>
            <strong>Brand angles:</strong>{" "}
            {analysis.brandAngles.join(", ")}
          </p>
          <p>
            <strong>Details:</strong> {analysis.visualDetails}
          </p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update imports**

Replace the import line at the top of the file:

```typescript
import type { GenerationResult, PhotoAnalysis } from "@/lib/ai/types"
```

- [ ] **Step 3: Replace the posts rendering loop**

Replace the posts mapping section (the `{result.posts.map((post) => {` block through its closing `})}`) — lines 88–210 in the current file — with:

```typescript
          {result.posts.map((post) => {
            const dayPlan = result.plan.find((p) => p.day === post.day)
            const isPhotoDay = post.photoId !== null && post.photoUrl !== null
            const photoAnalysis =
              post.photoId && result.photoAnalyses[post.photoId]
                ? result.photoAnalyses[post.photoId]
                : null

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
                  <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                    <h2 style={{ fontSize: "18px", fontWeight: 600 }}>
                      {post.day}
                    </h2>
                    {isPhotoDay && (
                      <span
                        style={{
                          fontSize: "11px",
                          backgroundColor: "#dbeafe",
                          color: "#1d4ed8",
                          padding: "2px 8px",
                          borderRadius: "9999px",
                        }}
                      >
                        Photo post
                      </span>
                    )}
                  </div>
                  {dayPlan && (
                    <span style={{ fontSize: "12px", color: "#888" }}>
                      {dayPlan.theme} · {dayPlan.angle}
                    </span>
                  )}
                </div>

                {isPhotoDay ? (
                  /* Photo day: side-by-side platform previews */
                  <div style={{ display: "flex", gap: "16px", marginBottom: "12px" }}>
                    {/* Instagram preview */}
                    <div style={{ flex: 1, borderRadius: "8px", overflow: "hidden", border: "1px solid #eee" }}>
                      <img
                        src={post.photoUrl!}
                        alt={`Photo for ${post.day}`}
                        style={{ width: "100%", height: "200px", objectFit: "cover", display: "block" }}
                      />
                      <div style={{ padding: "12px" }}>
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
                        <p style={{ whiteSpace: "pre-wrap", fontSize: "14px" }}>
                          {post.instagramCaption}
                        </p>
                      </div>
                    </div>

                    {/* Facebook preview */}
                    <div style={{ flex: 1, borderRadius: "8px", overflow: "hidden", border: "1px solid #eee" }}>
                      <img
                        src={post.photoUrl!}
                        alt={`Photo for ${post.day}`}
                        style={{ width: "100%", height: "200px", objectFit: "cover", display: "block" }}
                      />
                      <div style={{ padding: "12px" }}>
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
                        <p style={{ whiteSpace: "pre-wrap", fontSize: "14px" }}>
                          {post.facebookPost}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Text-only day: existing layout */
                  <>
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
                  </>
                )}

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

                {/* Photo analysis panel (collapsible) */}
                {isPhotoDay && photoAnalysis && (
                  <PhotoAnalysisPanel analysis={photoAnalysis} />
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
```

- [ ] **Step 4: Update metadata display to show photos used**

Replace the metadata paragraph (around line 76–85) with:

```typescript
          <p style={{ fontSize: "12px", color: "#888", marginBottom: "24px" }}>
            Generated at{" "}
            {new Date(result.metadata.generatedAt).toLocaleString()} · Model:{" "}
            {result.metadata.model} · Tokens:{" "}
            {result.metadata.planInputTokens +
              result.metadata.planOutputTokens +
              result.metadata.postsInputTokens +
              result.metadata.postsOutputTokens}{" "}
            total · Photos: {result.metadata.photosUsed}
          </p>
```

- [ ] **Step 5: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/generate-preview/page.tsx
git commit -m "feat: update preview page with side-by-side photo layout and analysis panel"
```

---

### Task 14: Manual integration test

No automated tests for the prototype — this is the same approach Session 5 used. Test the full flow manually.

- [ ] **Step 1: Run the seed script if not already run**

```bash
npm run seed:cafe
```

Expected: Either creates the client or says it already exists.

- [ ] **Step 2: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 3: Test zero-photos case**

Open `http://localhost:3000/admin/generate-preview` and click "Generate Week." With no photos in the database, this should produce the same text-only output as before. Verify:
- All 7 days render
- No errors in the console
- `metadata.photosUsed` shows 0
- No photo-related UI elements visible

- [ ] **Step 4: Upload a test photo via curl**

Use the stable Café de Hoek client ID and any JPEG photo:

```bash
curl -X POST http://localhost:3000/api/photos/upload \
  -F "file=@/path/to/test-photo.jpg" \
  -F "clientId=cafe-de-hoek-00000000"
```

Expected: JSON response with `analysisStatus: "succeeded"` and the photo row including a populated `analysis` object.

- [ ] **Step 5: Test photo-grounded generation**

Click "Generate Week" again. Verify:
- The uploaded photo appears in at least one day's card
- Photo days show side-by-side Instagram/Facebook layout with the image
- Text-only days show the original layout
- `metadata.photosUsed` shows 1
- "Photo post" badge appears on the photo day
- Collapsible "What Claude saw" panel works on photo days

- [ ] **Step 6: Test analysis retry**

```bash
curl -X POST http://localhost:3000/api/photos/<PHOTO_ID>/analyze
```

Expected: JSON response with `analysisStatus: "succeeded"`.

- [ ] **Step 7: Commit any fixes**

If any fixes were needed during testing, commit them:

```bash
git add -A
git commit -m "fix: integration test fixes for photo-grounded generation"
```
