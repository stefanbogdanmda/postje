# AI-Assisted Brand-Voice Extraction from Kickoff Transcript — Design Spec

**Date:** 2026-06-15
**Status:** Draft
**Scope:** Admin-side onboarding helper. Drafts the brand-voice profile fields from a pasted kickoff-call transcript. Human-in-the-loop: the operator reviews and edits every field before saving.
**Depends on:** Admin Client Management (2026-05-06), existing `src/lib/ai/` patterns.

---

## 1. The Problem and the Goal (Plain English)

When a new client signs up, Postje needs a "brand-voice profile" — the handful of fields that tell the AI how to write like this specific business. Today there are five of these fields and they are typed in **by hand** in the admin form:

- **Tone of voice** — how the posts should sound (warm, direct, playful…)
- **Target customers** — who the posts are talking to
- **Brand personality** — how the owner comes across
- **Banned phrases** — words/phrases the AI must never use
- **Example posts** — real posts in the business's own voice, for the AI to imitate

Right now Stefan does the kickoff call, then sits down and writes all five fields from memory and notes. That is slow, and slow onboarding is the one thing the whole product can't afford. Postje's core promise is "we run your social media, you spend 5 minutes a week." The faster a new client goes from "signed up" to "account ready," the faster Postje gets a paying client and the less of Stefan's day each client eats.

**The goal:** let Stefan paste the call transcript, press a button, and get a *first draft* of all five fields filled in automatically — drawn from what the client actually said on the call. Stefan then reads it, fixes anything wrong, and saves. The machine does the typing; the human keeps the judgment.

**What this is NOT:** it is not a way to skip the human. The AI drafts; Stefan decides. Nothing is saved to the client until Stefan clicks save. This matters because the brand-voice profile is the source of every post the client ever sees — getting it wrong quietly would be worse than getting it slowly.

### A term to define up front

**Transcript** — just the text of what was said on the call, written out. Like the subtitles of a video, but as one block of text. In v1, *someone else produces this text* (see Constraints). Postje does not record or transcribe audio itself yet.

---

## 2. Why Audio Transcription Is Out of Scope (Budget)

The spec describes a "recorded kickoff call [that is] transcribed." Turning recorded audio into text is a separate, paid capability — it needs a transcription service (e.g. a speech-to-text API). That is a **new paid service**, and the project rule is clear: until the first paying client, no new monthly subscriptions or new paid services unless they directly unblock revenue.

So **v1 assumes the transcript already exists as plain text.** Stefan can get that text however he likes for free — e.g. the auto-generated transcript from the video-call tool he already uses (Google Meet, Zoom, Teams all produce one), or by typing up notes. Postje's job starts at "here is the text," not "here is the audio."

This is a deliberate, documented limit, not an oversight. Audio → text is a clean future add-on once revenue justifies the paid service. The whole feature is designed so that swapping in real transcription later changes only *where the text comes from*, not anything downstream.

---

## 3. The Flow (Plain English)

```
Stefan finishes kickoff call
        │
        ▼
Gets transcript text (from the call tool, free)
        │
        ▼
Opens the client's edit page → "Draft from transcript" panel
        │
        ▼
Pastes transcript → clicks "Extract brand voice"
        │
        ▼
Claude reads the transcript → returns a structured draft of the 5 fields
        │
        ▼
Draft appears so Stefan can compare it to the current form values
        │
        ▼
Stefan picks which suggestions to apply → edits freely → clicks "Save Changes"
        │
        ▼
Profile saved (existing save flow). Client can be activated.
```

The key shape: **extraction populates the form, it does not write to the database.** The existing "Save Changes" action (`updateClient` in `src/app/admin/clients/actions.ts`) remains the *only* thing that writes the profile. The extraction step is a helper that fills in the boxes; saving is unchanged and still fully under Stefan's control.

---

## 4. Where This Lives in the UI

This is a **small, additive change** to the existing edit-client page (`src/app/admin/clients/[id]/`). No new top-level page.

### The "Draft from transcript" panel

Add a collapsible panel at the top of the **Brand voice** section in `edit-client-form.tsx` (the section that already groups tone/target/personality/banned/examples). Collapsed by default so it doesn't clutter the form for clients whose profile is already set.

Panel contents:

- A short helper line in Postje's friendly voice: *"Plak hier het transcript van het kennismakingsgesprek. We maken een eerste opzet van de merkstem — jij controleert alles voordat je opslaat."* (Paste the kickoff-call transcript here. We'll draft the brand voice — you check everything before saving.)
- A large `<textarea>` for the transcript.
- A button: **"Extract brand voice"** (becomes "Bezig met lezen…" / "Reading…" while running).
- After extraction: a **review block** showing, for each of the five fields, the **suggested value** with an **"Apply"** button (and an **"Apply all"** at the top). Applying a suggestion writes it into the corresponding existing form field — it does not save.
- If a field already has a value in the form, show that current value next to the suggestion so Stefan sees what would be overwritten before he applies. Never silently overwrite.

### Why "Apply into the form" rather than "auto-fill on arrival"

If extraction dumped straight into the fields, Stefan could save without ever really reading it — exactly the human-skip we want to avoid. Making him click "Apply" (per field or all-at-once) is a deliberate speed bump that keeps the human in the loop while still being one click for the happy path.

### Visual style

Matches the existing admin aesthetic (from the admin-client-management spec): #1a1a1a primary buttons, #ddd borders, 6px radius, 13px labels, inline styles, ~500px form column. The suggestion review block uses light cards (1px #ddd border, 8px radius, 16px padding). Suggested-value text in normal color; the "current value" comparison in #666. No new design language.

---

## 5. The Extraction Step (How It Works)

This reuses the patterns already in `src/lib/ai/`. No new dependencies.

### New module: `src/lib/ai/extract-brand-voice.ts`

A single function, in the same style as `regenerate-post.ts`:

```
extractBrandVoice(transcript: string, clientId: string): Promise<BrandVoiceDraft>
```

- Uses `getAnthropicClient()` from `src/lib/ai/client.ts`.
- Model: `claude-sonnet-4-6` (same model the rest of the pipeline uses — consistent, predictable, cheap).
- Sends the transcript with a structured prompt (below) and parses the reply with the existing `extractJSON<T>()` helper from `src/lib/ai/extract-json.ts`.
- Returns a typed `BrandVoiceDraft` object that maps **one-to-one** onto the profile columns.

### The output shape (maps to the exact profile columns)

The five target columns on the `clients` table are: `toneOfVoice` (text), `targetCustomers` (text), `brandPersonality` (text), `bannedPhrases` (string[]), `examplePosts` (string[]). The draft mirrors them exactly:

```typescript
interface BrandVoiceDraft {
  toneOfVoice: string          // free text → clients.toneOfVoice
  targetCustomers: string      // free text → clients.targetCustomers
  brandPersonality: string     // free text → clients.brandPersonality
  bannedPhrases: string[]      // list → clients.bannedPhrases
  examplePosts: string[]       // list → clients.examplePosts (quoted from transcript only)
  notes: string                // English: what was confident, what was guessed, what's missing
}
```

`notes` is shown to Stefan above the suggestions ("here's what I was unsure about") and is **not** saved to any column. It exists only to make the AI's confidence visible so Stefan knows where to look harder.

Mapping to the form: `toneOfVoice`, `targetCustomers`, `brandPersonality` apply directly to their textareas. `bannedPhrases` applies as newline-joined text (the form already parses lines via `parseLines`). `examplePosts` applies as blank-line-separated text (the form already parses via `parseExamplePosts`). No new parsing logic needed — the draft feeds the existing form fields, which feed the existing save action.

### Guardrails (these are the important part)

The brand-voice profile drives every future post, so the prompt must be conservative. Hard rules baked into the system prompt:

1. **Never invent banned phrases.** Only list a phrase as banned if the client (or Stefan) explicitly said to avoid it on the call. If nothing was said, return an **empty** `bannedPhrases` array. An empty list is correct and safe — the generation pipeline already merges in sensible defaults (`DEFAULT_BANNED_PHRASES` in `client-profile.ts`). A guessed banned phrase would silently distort writing.
2. **Example posts must be real quotes from the transcript.** Only include text the client actually spoke as an example of how they'd write/talk about their business. **Do not fabricate example posts.** If the client gave no usable examples, return an empty `examplePosts` array. (Inventing examples would teach the AI a voice the business never used.)
3. **Tone / target / personality: describe, don't embellish.** Summarize what's evident in the transcript. If something wasn't discussed, say so in `notes` and keep the field short rather than padding it with marketing language.
4. **Dutch-friendly, no corporate tone.** The drafted `toneOfVoice` / `brandPersonality` describe the business's voice and may quote Dutch; the *summaries themselves* avoid corporate Dutch, matching the Postje brand rule.
5. **Output valid JSON only**, matching the structure exactly — same contract style as `regenerate-post.ts`. The `extractJSON` helper tolerates markdown fences, but the prompt still asks for clean JSON.

### Prompt structure (sketch — not final code)

- **System prompt:** "You are helping onboard a small Dutch business onto a social-media service. From a kickoff-call transcript, draft a brand-voice profile. You summarize only what the transcript supports. You never invent banned phrases. You never fabricate example posts — example posts must be verbatim quotes from the transcript. When something wasn't discussed, leave that field short/empty and note it. Respond with valid JSON only, in this exact shape: {…}."
- **User prompt:** "Here is the kickoff-call transcript for {businessName}:\n\n{transcript}\n\nReturn the JSON draft."
- `businessName` is read from the client row (scoped by `clientId`) so the model has context. No other client data is required for extraction.

### Error handling

- Empty/very short transcript (e.g. under a small minimum length) → don't call Claude; return a friendly inline message ("Dit transcript lijkt te kort om iets uit te halen." / This transcript looks too short).
- Claude API error, timeout, or JSON parse failure → show an inline error ("Kon de merkstem niet uithalen. Probeer het opnieuw." / Couldn't extract — try again). The form keeps whatever Stefan already had. No partial application. No data saved.
- A 529 / overload from the API surfaces as the same "try again" message; this is a transient retry, not a code failure.

### Cost

One Sonnet call per extraction. A long kickoff transcript (say ~8–15k words) is on the order of a few cents in input tokens; output is tiny. Extraction runs once per client at onboarding (occasionally re-run). Cost is negligible and falls under the existing pay-per-use Claude API line — **no new paid service.**

---

## 6. Where the Server Work Happens

Two clean options; the spec recommends the first for consistency with the existing code:

**Recommended — a server action** alongside `createClient`/`updateClient` in `src/app/admin/clients/actions.ts`:

```
extractBrandVoiceForClient(clientId: string, transcript: string): Promise<{ draft?: BrandVoiceDraft; error?: string }>
```

- Same `"use server"` admin pattern already used in that file: first line checks `auth()` and `session.user.role === "admin"` and returns `{ error: "Unauthorized" }` otherwise. **Only Stefan (admin) can run extraction.**
- Looks up the client by `clientId` (scoped) to get `businessName`, calls `extractBrandVoice()`, returns the draft. Does **not** write to the DB.
- Returns `{ error }` on failure, mirroring the existing `ActionResult` style, so the client form can render it inline.

This keeps extraction next to the other client actions, reuses the admin-auth guard, and avoids inventing a new API route convention.

---

## 7. Data and Privacy (GDPR)

A kickoff transcript can contain **personal data** — names, opinions, possibly third parties mentioned in passing. Under GDPR this must be handled deliberately. "GDPR compliance is a launch blocker, not a building blocker" — so the *design* must be GDPR-clean now even though the lawyer review happens before first paid client.

### Decision: the transcript is **transient**, not stored.

- The pasted transcript lives only for the duration of the extraction request (in the textarea on Stefan's screen and in the single Claude call). **It is not written to any column or table.**
- What gets persisted is only the *summarized profile fields* Stefan chooses to apply and save — which are operational brand settings, not the raw recording of a person speaking.
- This minimizes stored personal data (GDPR data-minimization) and removes the need for a "delete the transcript" feature, transcript retention policy, or transcript export. There is simply no transcript at rest.

### If a transcript-storage feature is ever wanted later

It would be a separate spec and would need: a `clientId`-scoped table, a retention/deletion policy wired into the existing GDPR export/deletion flow (see `2026-05-12-gdpr-export-deletion-design.md`), and explicit consent tracking for the recording. **Out of scope here. v1 stores nothing.**

### Third-party processing note

Sending the transcript to the Claude API means a third party (Anthropic) processes it transiently. This belongs in the Data Processing Agreement / sub-processor list the lawyer will review before launch. Flagging it here so it isn't missed — it does not block building.

### client_id scoping

The extraction action is scoped: it looks up exactly one client by `clientId`, reads only that client's `businessName`, and the apply/save path uses the existing `updateClient(clientId, …)` which already filters by `clientId`. No cross-client read or write is possible. Consistent with the project rule that every client-data query filters by `client_id`.

### Secrets

The Anthropic key is read via `getAnthropicClient()` from `process.env.ANTHROPIC_API_KEY` — never in code, never returned to the browser. The draft and any error messages returned to the client form contain no secrets. Consistent with existing AI modules.

---

## 8. Scope

**In scope (v1):**
- New lib module `src/lib/ai/extract-brand-voice.ts` (single Claude call, structured JSON, reuses existing helpers).
- New `BrandVoiceDraft` type (in `src/lib/ai/types.ts`, alongside the other AI types).
- New admin server action `extractBrandVoiceForClient` in `src/app/admin/clients/actions.ts` (admin-guarded, `clientId`-scoped, read-only to the DB).
- "Draft from transcript" collapsible panel added to `edit-client-form.tsx`: transcript textarea, extract button, per-field suggestion review with Apply / Apply all, current-value comparison, inline error/loading states.
- Guardrails enforced in the prompt: no invented banned phrases, example posts quoted from transcript only.
- Transcript handled transiently — nothing stored.
- Unit test for the guardrail-relevant parsing if any new parsing is introduced (none expected; reuses `parseLines`/`parseExamplePosts`).

**Out of scope (explicit):**
- **Audio recording or speech-to-text** — transcript is provided as text. Future feature, gated on revenue (new paid service).
- **Storing transcripts** — nothing persisted; no transcript table, retention, or export.
- Adding the panel to the **create** page (`/admin/clients/new`) — extraction is offered on the **edit** page only in v1, since onboarding flows through "create, then refine." (Could be added later trivially; left out to keep scope tight.)
- Auto-saving the profile from extraction — save stays manual via the existing action.
- Re-running extraction history / versioning of drafts.
- Client-facing exposure — this is admin-only; clients never see it.

---

## 9. Acceptance Criteria / Definition of Done

Against the project's Definition of Done:

1. **It works** — Stefan pastes a real-ish transcript, clicks Extract, sees a structured draft of all five fields, applies them into the form, and saves via the existing flow.
2. **It works for wrong inputs** — empty/too-short transcript, gibberish, and API failure all produce clear inline messages and never crash, never partially save.
3. **Scoped to the right client** — extraction reads only the named client (`clientId`), save uses the existing `clientId`-filtered `updateClient`. Verified with at least two test clients that one client's transcript never lands on another's profile.
4. **Secrets not exposed** — no API key in code, logs, error text, or browser payloads.
5. **Guardrails verified** — with a transcript that mentions no banned phrases, `bannedPhrases` comes back empty (not invented). With a transcript containing no example posts, `examplePosts` comes back empty (not fabricated). With a transcript that *does* contain a spoken example, that example appears verbatim.
6. **Human-in-the-loop verified** — nothing is written to the DB until Stefan clicks "Save Changes." Extraction alone changes no stored data.
7. **Plain-English description still matches** — re-read Section 1; the build does exactly "paste transcript → draft fields → human reviews/edits → save."
8. **On a branch, reviewed, merged, deployed** — built on its own branch with a PR, reviewed with Stefan, then merged and confirmed working in production.
9. **Stefan can describe it** — in his own words: "I paste the call, it fills in a first draft, I fix it, I save."

---

## 10. Risks

| Risk | Mitigation |
|------|------------|
| AI invents banned phrases or fake example posts, quietly poisoning the voice | Hard prompt guardrails + empty-list-is-valid + Stefan reviews every field before saving. Acceptance test #5 checks both. |
| Stefan rubber-stamps the draft without reading (human-skip) | Per-field "Apply" with current-value comparison; nothing auto-fills; save is a separate deliberate click. |
| Transcript PII handled carelessly | Transcript is transient, never stored; flagged for the DPA/sub-processor list. No transcript-at-rest to leak. |
| Long transcript → token cost or context limits | Sonnet handles long context fine; cost is cents. If a transcript is extreme, the call still works; revisit truncation only if observed. |
| API overload (529) during a call | Surfaces as a friendly "try again"; transient, not a code bug. |
| Scope creep into audio transcription | Explicitly fenced off as a paid future feature; v1 design isolates "where text comes from" so the add-on is clean. |

---

## 11. Who Builds It

- **postje-ai-engineer (primary):** `src/lib/ai/extract-brand-voice.ts`, the `BrandVoiceDraft` type, the prompt + guardrails, the `extractBrandVoiceForClient` server action. This is the bulk of the work and lives entirely in the AI/server layer they own.
- **Frontend (small touch):** the "Draft from transcript" panel in `edit-client-form.tsx` — textarea, extract button, suggestion review with Apply/Apply-all, current-value comparison, loading/error states. A modest addition to one existing component, matching the established admin styling. Can be done by the AI engineer or a frontend specialist; small enough not to need a dedicated owner.

No database migration. No new dependency. No new paid service.

---

## 12. Decisions Log

| Decision | Rationale |
|----------|-----------|
| Transcript provided as text; no audio transcription | Speech-to-text is a new paid service; budget rule bars it pre-revenue. Free call-tool transcripts cover v1. |
| Transcript is transient, never stored | GDPR data-minimization; removes retention/deletion/export burden; no PII at rest. |
| Extraction fills the form, never the DB | Keeps the human in the loop; `updateClient` stays the only writer. |
| Per-field "Apply" + current-value comparison | Prevents silent overwrite and rubber-stamping. |
| Empty `bannedPhrases` / `examplePosts` is valid output | Guardrail against invented phrases / fabricated examples; defaults already merged downstream. |
| Reuse `getAnthropicClient`, `extractJSON`, `parseLines`, `parseExamplePosts`, `claude-sonnet-4-6` | Consistency with existing pipeline; no new patterns or deps. |
| Edit page only, not create page, in v1 | Tight scope; onboarding flows create→refine; trivially extendable later. |
| Admin-only server action with auth guard | Same pattern as `createClient`/`updateClient`; clients never touch this. |
