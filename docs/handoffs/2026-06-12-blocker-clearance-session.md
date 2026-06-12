# Handoff — 2026-06-12: Blocker clearance & Phase 1/2 polish

## What this session did

Started from a two-agent launch-readiness review of Postje, then cleared every
**code-fixable** go-live blocker and shipped the well-scoped polish. All work
merged to `main` via PRs, each green on the `ci` gate (lint + type-check + full
vitest suite + build).

### Merged PRs
| PR | Area | Summary |
|----|------|---------|
| #21 | Phase 0 | Flag ownership check, activated `middleware.ts` (was dead `proxy.ts`), `assertEnv()` at boot via `instrumentation.ts`, removed orphan `0004` migration, Neon `ws` config, **repaired CI** (lockfile was missing `@esbuild/*` so `npm ci` failed). |
| #22 | Phase 1 (B1) | Client **brand-voice profile UI** — `tone/targetCustomers/brandPersonality/bannedPhrases/examplePosts` are now written by create/edit forms (columns existed but nothing populated them → generation fell back to generic café defaults). |
| #23 | Phase 1 (B2) | **Generate for any client** — the generate-preview page was hardcoded to the seeded café; added a client picker. |
| #24 | Phase 1 (item 10) | **De-café'd the generation prompts** — closure is judged from opening hours (not hardcoded Monday), emoji/example guidance is generic, leans on the client's own example posts. |
| #25 | Phase 1 (item 9) | **3–6 posts/week cap** — per-client `postsPerWeek` (default 5, clamped 3–6), planner asked for N days, server-side cap as a safety net. Migration `0006_nasty_bloodstorm`. |
| #26 | Phase 2 (C1) | **Publisher claim-lock** — `approved → publishing` claim before the Meta call, so a cron + manual "Publish now" race can't double-post. New `publishing` status (text column, no migration). |
| #27 | Phase 2 (G1) | **Honest Meta data-deletion callback** — was a stub reporting `completed` while deleting nothing. Now records requests (`meta_deletion_requests`, migration `0007_brave_abomination`) and reports the real state. No Meta `user_id → client` mapping exists, so resolution stays manual but truthful. |
| #28 | Phase 1 polish | **Calibration → 14 days** and actually populated (`calibrationStartDate` was never set; query now `COALESCE`s with `createdAt`). |
| #29 | Phase 1 polish | **Immediate operator email on flag** (`flag-email.ts`), best-effort. |
| #30 | Phase 4 | **Complete GDPR export** — added `metaConnections` (no token), `postFlags`, `publishAttempts`; `EXPORT_SCHEMA_VERSION` → 2. |
| #31 | Phase 4 | **Tenant-isolation tests** for `flagPostAction` / `cancelApprovedPostAction` (the action boundary where the #21 bug had slipped through). |

Where `main` ended up: the full **configure → generate → review → publish**
loop works for any client at the right cadence and voice; both publishing-safety
blockers are gone.

## Action item ON the developer (not code)

**Vercel deployments fail** — the build can't find `DATABASE_URL`. Root cause is
pre-existing: `src/db/index.ts` throws at import, and `next build` imports route
modules during page-data collection. The GitHub `ci` gate is green (it builds
with placeholder env). Fix: set `DATABASE_URL`, `AUTH_RESEND_KEY`, `AUTH_SECRET`,
`CRON_SECRET`, `ANTHROPIC_API_KEY` for Vercel **Preview and Production**
environments. (Optional code hardening considered but declined: lazy DB init so
the build doesn't need DB secrets.)

Other pre-launch verification that can't be done from the sandbox:
- Run `npm run db:migrate` against a throwaway Neon branch (now `…0006 → 0007`).
- Confirm middleware login/redirect in a Vercel preview.
- Run one real end-to-end weekly cycle.
- Confirm `.env.example` matches `src/lib/env.ts`.

## What's left — each needs a one-line product/infra decision

1. **"Posts ready for review" client email.** Deliberately NOT auto-wired: the
   only generator is the page labelled "Preview", so emailing on every click is
   surprising. Decide the trigger: weekly generation cron / an explicit "notify
   client" action / accept that generating == notifying.
2. **Automated weekly-generation cron + sub-daily `publish-due`.** Gated by
   **Vercel Hobby's once-per-day cron limit** (budget rule: no paid tier yet) and
   needs a small design (which clients, which day, calibration/locked-day
   interplay). Today `publish-due` runs daily at 09:00 → a post scheduled for
   18:00 publishes next morning.
3. **Error / cron-failure monitoring** (Sentry etc.) — a paid service, deferred
   per the budget rule.
4. **More action/route tests** — no decision needed; extend the #31 harness
   (`vi.mock` auth/`next/cache`/`@/db` with a per-test PGlite db) to the
   account-deletion/export actions and the admin client actions next.

## Notes for whoever picks this up
- Test suite is slow under fork isolation + PGlite (~6 min full run); targeted
  `vitest run <path>` is much faster while iterating.
- `attention.ts` (`getAttentionData` + its 7-day calibration) is **dead code** —
  the live attention page uses `attention-queries.ts`. Candidate for removal.
- Migration tooling: `drizzle-kit generate` with a placeholder `DATABASE_URL`
  works for generating; the runtime `db:migrate` path still wants real verification.
