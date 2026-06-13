# Handoff — Part A Improvements Continuation

Drop this whole document into a fresh chat to continue Postje's operational improvements where the previous session left off. Read top to bottom before doing anything.

---

## Where we are right now

**The Postgres migration just shipped.** Branch `feat/postgres-migration` is pushed to `origin` (https://github.com/stefanbogdanmda/social-ai), waiting on the human to:

1. Open the PR via GitHub web UI (body draft at `.pr-body-postgres.md` in the repo root). The `gh` CLI is not installed locally, so the PR can't be opened from the terminal.
2. Manually update `.env.example` to include `DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require` (Claude's permissions block writing to `.env*` files — this has to be a human edit).
3. Smoke-test in the browser: `npm run dev`, then `http://localhost:3000/login`, enter `admin@example.com`, magic-link login, click around `/admin`. Existing browser cookies from before the migration will cause `ERR_TOO_MANY_REDIRECTS` until cleared (incognito works too).
4. Merge to `main`.

**Until that PR is merged**, future improvement plans should be written on branches based on `main` AS IT IS NOW (still SQLite-based) and rebased onto the merged Postgres state. Alternatively, base new branches on `feat/postgres-migration` directly — that's fine too as long as the Postgres branch is the parent.

**Once the PR is merged**, every future plan starts from a Postgres-only baseline.

## What you (Claude in the new session) need to know about the project

- Read `CLAUDE.md` in the repo root first. That's the project's operating manual.
- Read `docs/social-ai-spec.md` for the product vision.
- The developer (Stefan, `admin@example.com`) is learning while building. Teaching mode is always on. When you use a technical term for the first time in a conversation, define it briefly. Check understanding rather than assume it. Plain English first, code second.
- Tech stack: Next.js 16 (App Router) + TypeScript + Drizzle ORM + **Neon Postgres** (NOT SQLite — that just got migrated away) + Auth.js 5 (magic links via Resend) + Vercel Cron + `@vercel/blob` for photos. Vitest 4 for tests. PGlite for in-memory test DB.
- The user is on **Windows + PowerShell**. Many shell commands need PowerShell syntax (`Remove-Item` not `rm`), or use the Bash tool for POSIX-style commands.
- Free-tier budget. No new paid services unless they unblock revenue. Don't propose `dotenv-cli`, `vercel`-only features beyond the marketplace free tier, etc.
- No Vercel project exists yet — the app runs locally against Neon. Deploying to Vercel is a separate future plan, not a prerequisite for the Part A improvements below.
- The user explicitly wants the **Superpowers workflow**: brainstorming → writing-plans → executing-plans → verification. For UI features, also invoke `frontend-design`. For implementation, prefer `subagent-driven-development` (fresh subagent per task, two-stage review per task: spec compliance + code quality).

## Reference documents in the repo

| Path | Purpose |
|---|---|
| `docs/superpowers/specs/2026-05-11-part-a-improvements-sequencing.md` | Master sequencing doc — the 5 Part A improvements in order. Postgres is #1, already done. |
| `docs/superpowers/plans/2026-05-11-postgres-migration.md` | The detailed Postgres plan that just shipped. Useful as a template for plan structure: bite-sized TDD steps, frequent commits, spec/quality review per task. |
| `~/.claude/projects/c--Users-stefa-projects-social-ai/memory/project_feature_backlog.md` | NET-NEW features (Part B from earlier research). Do NOT confuse with Part A improvements. Reference only when user asks "what feature should we build next" — for now, finish Part A first. |
| `~/.claude/projects/c--Users-stefa-projects-social-ai/memory/feedback_frontend_design_skill.md` | Reminder: always invoke `frontend-design` skill for real UI features, not just client-facing ones. |
| `~/.claude/projects/c--Users-stefa-projects-social-ai/memory/feedback_no_secrets_in_chat.md` | Reminder: never ask the user to paste secrets into chat. |

## The four remaining Part A improvements

Order is dependency-based plus impact: do them in this order unless the user says otherwise. Each is its own design spec + plan + branch + PR. Do NOT bundle them.

### #2 — Rate-limit persistence (next up; smallest)

**Problem:** `src/lib/rate-limit.ts` currently uses an in-memory `Map<string, number[]>` to track magic-link request counts per email. On Vercel, each function instance gets its own memory, so the limiter is bypassable by hitting different instances. Also, the limit doesn't survive a server restart.

**Now that Postgres is in place**, the fix is small: ~150 lines.

**Approach:**
- New table `authThrottle` (or extend `verificationTokens` if cleaner) keyed by lowercased email + window-start timestamp + request count. Either a sliding-window log or a simple counter with reset is fine.
- One repository pair: `recordMagicLinkRequest(email)` returning whether the request is throttled; an internal cleanup function for stale rows.
- Swap the in-memory Map in `src/lib/auth.ts`'s `sendVerificationRequest` callback for the new DB-backed function.
- Tests: PGlite-based, cover the "5 within 15 min" boundary, ensure email lowercasing is enforced, ensure failed sends still throttle (the existing in-memory version does — preserve that).

**Estimated effort:** S — half a day.

**Suggested first prompt to start:** "Write a design spec for Part A improvement #2 (rate-limit persistence). Read `src/lib/rate-limit.ts`, `src/lib/auth.ts`, and the regen-limit-alerts plan as the structure template. Use the brainstorming skill first to clarify the storage shape (new table vs. extend existing), then writing-plans to produce the bite-sized plan. Save spec at `docs/superpowers/specs/YYYY-MM-DD-rate-limit-persistence-design.md` and plan at `docs/superpowers/plans/YYYY-MM-DD-rate-limit-persistence.md`."

### #3 — Owner Attention List dashboard

**Problem:** The current admin page at `src/app/admin/page.tsx` is a raw inline-styled table of users. The spec calls for an "Attention List" — a prioritized view of "what does Stefan need to look at right now" pulling from already-stamped columns: `posts.firstSeenAt`, `posts.alertedAt` (stale post alerts), `posts.regenLimitAlertedAt` (regen-limit alerts), `posts.publishError`, calibration period status, etc.

**Now that the data is already in the DB** (those alerts shipped just before Postgres), this is pure UI + aggregation SQL. No new schema.

**Approach:**
- Design phase: this is an owner-facing UI. **Invoke the `frontend-design` skill** alongside brainstorming. Push for a specific aesthetic direction — bento layout? editorial? Don't ship default-Tailwind generic UI. The brand voice (per `CLAUDE.md` and the spec) is intentional, opinionated.
- One new page or refactor of `src/app/admin/page.tsx` into something like `src/app/admin/attention/page.tsx` with sections: stale drafts, regen-limit hit, publish errors, slow approvers, recent rejections by client, etc.
- Aggregation queries — write them in a new `src/lib/admin/attention.ts` repository or extend `src/lib/posts/repository.ts`.
- Deep-link each row to the specific resource (post/client) so Stefan one-click acts on it.
- Tests: PGlite, exercise each aggregation with realistic seed data.

**Estimated effort:** M — 2-3 days, mostly because of design care.

**Suggested first prompt to start:** "Write a design spec for Part A improvement #3 (Owner Attention List dashboard). Invoke `frontend-design` first to land on an aesthetic direction, then `brainstorming` to clarify which signals belong on the list. Read `src/app/admin/page.tsx` and the alert modules (`src/lib/alerts/*`) for context. Save spec at `docs/superpowers/specs/YYYY-MM-DD-attention-list-design.md`."

### #4 — GDPR data export + deletion request

**Problem:** `CLAUDE.md` calls GDPR compliance a "launch blocker." The current state has zero client-facing path to export or delete data — only Stefan-as-admin can delete via `src/app/api/admin/delete-user/route.ts`. A real EU SaaS needs a client-facing "Export my data" and "Delete my account" flow.

**Approach:**
- Two new client-facing routes / Server Actions:
  1. **Export** — collect every row scoped to the logged-in client's `clientId` (posts, photos, brand info, approval/rejection history). Return as a downloadable JSON file. Include a stable schema version field in case the format changes later.
  2. **Delete** — request flow with a confirmation email (Resend) and a 24h cooling-off period before actual deletion. Use the existing `deletionAuditLog` table.
- A small UI surface (probably in a "Settings" or "Account" section of the client dashboard). Modest design — this isn't a hero page, it's a compliance form.
- Photo blobs in Vercel Blob need cascading deletion when the client is deleted. Currently the schema has `onDelete: cascade` for `photos` (FK from `clients`), but Blob URLs are public — the actual blob files stay forever unless explicitly deleted via the Blob SDK. Plan must address this.
- Tests: cover the export shape; cover the deletion-request → email → confirm → delete flow; cover that deletion of one client doesn't touch another's data (tenant isolation).

**Estimated effort:** M — 2-3 days.

**Suggested first prompt to start:** "Write a design spec for Part A improvement #4 (GDPR data export + deletion request flow). Read `CLAUDE.md` §10 and §11 for the safety rules, `src/db/schema.ts` for which tables hold client data, and `src/app/api/admin/delete-user/route.ts` for the admin-side delete pattern. Use `brainstorming` first to pin down the deletion cooling-off period and the export's exact shape. Save at `docs/superpowers/specs/YYYY-MM-DD-gdpr-export-deletion-design.md`."

### #5 — Publisher path

**Problem:** Posts get `publishAt` stamped when approved, but nothing consumes it. A real client cannot be served by Postje today — approved posts sit forever. The central product promise (auto-publishing to Instagram + Facebook) isn't wired.

**Approach:** This is the biggest and most ambitious of the four. It deserves its own design spec before any plan, and the spec will need to choose between two delivery models:

- **Manual v1:** Cron job runs every N minutes, finds posts where `status = 'approved' AND publishAt <= now()`, surfaces them in an admin "ready to publish" queue, Stefan clicks "publish now" which actually POSTs to Meta Graph API. Lower complexity, keeps the human in the loop early.
- **Auto v1:** Same cron, but it publishes automatically without human intervention. Higher risk (a bad post goes live), but matches the product promise.

Decision is the user's. Either way, the spec needs to cover:
- Meta Graph API OAuth (Instagram Business + Facebook Page). Token storage encrypted at rest. The schema doesn't have a Meta-tokens table yet.
- Retry semantics — what happens when Meta returns 503, rate-limits, content rejected?
- Status transitions: `approved` → `publishing` → `published` OR `failed` (with `publishError` populated; already in schema).
- Webhook for publish-status updates from Meta.
- Test strategy — mock the Meta API; have a sandbox/test mode.

**Estimated effort:** L — 1-2 weeks of careful work. Will likely produce 2-3 plans (OAuth + token storage, the publisher itself, the admin UI for the queue).

**Suggested first prompt to start:** "Write a design spec for Part A improvement #5 (publisher path to Meta Graph API). This is the biggest of the Part A improvements. Use `brainstorming` extensively — first to decide between manual-publish-from-queue vs. fully-automatic publishing, then to enumerate the failure modes (rate-limits, content rejection, expired tokens). Read `src/db/schema.ts` (the `publishAt` and `publishError` columns already exist), `src/app/api/cron/check-alerts/route.ts` (existing cron pattern), and `CLAUDE.md` §10 (security rules around encrypted Meta tokens). Do not start writing the plan until the spec has resolved at least the manual-vs-auto question. Save at `docs/superpowers/specs/YYYY-MM-DD-publisher-design.md`."

## Hard rules to follow in the new session

These come from `CLAUDE.md` §10 and the user's stated working preferences. Restating because they matter:

1. **Never write code outside a branch.** Every plan/spec gets its own branch. No commits directly to `main`.
2. **Never read `.env`, `.env.local`, or other secret files.** Use environment variables; trust the user that they're set.
3. **Never ask the user to paste a secret into chat.** Walk them through setting it in `.env.local` or via `vercel env` if applicable.
4. **Every database query must be scoped by `client_id`** where client data is involved. Tenant isolation isn't optional.
5. **Test against PGlite, not SQLite.** The test scaffolding at `src/test/db.ts` already uses PGlite.
6. **TIMESTAMPTZ for every timestamp column.** The schema already does this — don't accidentally regress to plain `timestamp`.
7. **The `Db` type alias is currently triplicated** across `src/lib/posts/repository.ts`, `src/lib/alerts/check-stale-posts.ts`, `src/lib/alerts/check-regen-limits.ts`. If you write a new repository file, extract the type to one shared location (e.g., `src/db/types.ts`) and import everywhere. This was flagged in the Task 7 code review as a follow-up.
8. **`@auth/drizzle-adapter` types `expires_at` as `integer` but the schema uses `bigint`.** This is bridged with an `as never` cast in `src/lib/auth.ts`. Leave that workaround in place until the adapter is updated upstream — don't try to "fix" the schema back to `integer` (that would silently truncate large epoch values).

## Suggested kickoff sequence for the new session

When you (Claude) start the new session, the first message from the user will probably reference this handoff or say "let's start improvement #2" or similar. Suggested first move:

1. Confirm the Postgres PR has been merged to `main`. If not, ask the user about its status — don't assume.
2. Confirm which improvement (#2, #3, #4, or #5) they want to tackle. Default to #2 (rate-limit persistence) since it's smallest and the natural next step.
3. Once chosen, invoke `brainstorming` (and `frontend-design` for #3) to clarify the design. Don't skip this. The brainstorming → spec → plan pattern is what this project ships on.
4. Save the design spec and plan in the same `docs/superpowers/specs/` and `docs/superpowers/plans/` folders. Date prefix every filename: `YYYY-MM-DD-feature-name(-design).md`.
5. Use `subagent-driven-development` for execution. Two-stage review per task. The Postgres migration shipped 13 commits with this exact workflow — copy that cadence.

## Quick state-of-the-world check (for the new session)

Run these to verify everything's coherent before starting work:

```bash
git status            # Should be clean or have only untracked docs
git log --oneline -5  # Most recent commit should be on main, post-Postgres-merge
npx tsc --noEmit      # Should be green
npm test              # Should be green (115+ tests)
```

If any of those fail, surface the failure to the user before proposing new work.

## Things explicitly out of scope for the new session

- Vercel deployment setup — separate decision, separate plan.
- Part B features (Edit-on-Approve, Banned Phrases UI, etc.) — see `~/.claude/projects/c--Users-stefa-projects-social-ai/memory/project_feature_backlog.md`. These wait until Part A is done.
- Refactors that aren't tied to one of the four improvements above. If the codebase smells, capture it as a follow-up issue, don't act on it unprompted.
