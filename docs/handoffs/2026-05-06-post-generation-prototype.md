# Handoff: Post Generation Prototype

Date: 2026-05-06
Branch: feature/post-generation-prototype
PR: pending merge (review on GitHub)

## What's done

Two-stage AI post generation pipeline is working end-to-end:

1. **Stage 1 (plan):** Claude generates a weekly content plan — themes, angles, platform differences for 7 days
2. **Stage 2 (write):** Claude writes the actual posts based on the plan, in Marloes's voice
3. **Validation:** Banned phrases and sentence length are checked automatically, warnings attached to output
4. **Preview page:** `/admin/generate-preview` — click a button, read the posts

Files:
- `src/lib/ai/types.ts` — TypeScript interfaces for the pipeline
- `src/lib/ai/client.ts` — Anthropic SDK singleton
- `src/lib/ai/prompts.ts` — System + user prompts for both stages
- `src/lib/ai/extract-json.ts` — Strips markdown fences from Claude responses
- `src/lib/ai/validate-posts.ts` — Checks banned phrases + sentence length
- `src/data/clients/cafe-de-hoek.ts` — Hardcoded fictional client profile
- `src/app/api/generate-posts/route.ts` — POST handler, two API calls
- `src/app/admin/generate-preview/page.tsx` — Developer preview UI

## What we proved

- Claude can write Dutch social media posts that sound like a real café owner
- Two-stage (plan → write) produces varied, non-repetitive content across a week
- Platform differentiation works (IG = short/punchy, FB = conversational)
- Hard constraints (banned phrases, sentence length) are enforceable via prompts
- The `extractJSON` approach handles Claude's formatting quirks reliably

## What's not done

- **Photo-grounded posts** — next prototype, separate branch. Tests whether Claude can write good posts about a specific image rather than inventing content freely.
- **Auth on the endpoint** — intentionally skipped for prototype
- **Database storage** — no posts are saved anywhere
- **Production prompt tuning** — current prompts are v1

## Known issues / lessons for next session

### FB post length didn't fully land

The prompt says "2-3 sentences, 4 only for storytelling." Model anchored on the exception and writes 4 sentences as default.

**Fix for v2:** Never phrase constraints as "default with exception." The model treats the exception as permission. Instead, phrase as a hard rule: "Maximum 3 sentences. Period." If a storytelling day genuinely needs 4, handle that in the plan stage (where you can explicitly flag which day gets the exception), not in a blanket voice rule.

### Sentence-length rule works when phrased as hard rule

"Target max ~15 words" → 4 of 7 posts violated it.
"No sentence over 15 words. Count before you write." → 1 of 14 posts violated it (16 words, borderline).

**Lesson:** For Claude, "target" means "aspire to." "Hard rule + count before you write" means "actually do it." Always use the hard framing for constraints that matter.

### extractJSON is fragile by design

It strips fences and finds the first `{`, but doesn't handle trailing text after valid JSON. Works because prompts say "valid JSON only" — but if prompts change, this will break. Production should use structured outputs (`output_config.format`).

## What to build next

1. **Photo prototype** — 3 hardcoded photos, same pipeline but Stage 2 includes the image. Tests: does voice stay natural when grounded in a real photo? Does the model describe what it sees or hallucinate?
2. **Client review UI** — the approval queue where clients approve/reject posts one at a time. This is the first real client-facing feature. Invoke frontend-design skill.
3. **Persona extraction** — parsing a recorded kickoff call into a client profile. Changes the prompt architecture (profile becomes dynamic, not hardcoded).

## How to resume

```
Paste this handoff into a new Claude Code session.
Branch: feature/post-generation-prototype (or main if merged)
Read: docs/superpowers/specs/2026-05-06-post-generation-prototype-design.md
```
