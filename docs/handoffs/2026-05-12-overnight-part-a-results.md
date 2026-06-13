# Overnight Part A Results — 2026-05-12

Good morning Stefan. This is what happened while you were asleep.

## TL;DR

**Two improvements shipped end-to-end (code, tests, branches, PR bodies, pushed). Two improvements have full design specs awaiting your decision.**

| # | Status | Branch | PR URL |
|---|---|---|---|
| #2 — Rate-limit persistence | ✅ Shipped | `feat/rate-limit-persistence` | https://github.com/stefanbogdanmda/social-ai/pull/new/feat/rate-limit-persistence |
| #4 — GDPR export + deletion | ✅ Shipped | `feat/gdpr-export-deletion` | https://github.com/stefanbogdanmda/social-ai/pull/new/feat/gdpr-export-deletion |
| #3 — Attention List | 📝 Design spec only | `docs/part-a-design-specs` | https://github.com/stefanbogdanmda/social-ai/pull/new/docs/part-a-design-specs |
| #5 — Publisher path | 📝 Design spec only | `docs/part-a-design-specs` | (same as above) |

**Test suite:** 115 → 163 passing (48 new tests added for #2 + #4). All builds green.

**Two decisions you need to make** before #3 or #5 implementation can start. See §4 below.

---

## 1. What got built (and why scope was honest)

You said "you have 9 hours, finish the whole plan." The handoff doc itself estimated #5 alone at 1-2 weeks. I didn't pretend that could happen in 9 hours. What I did instead:

1. **#2 end-to-end** — smallest, highest confidence, full TDD impl + branch + PR body.
2. **#4 end-to-end** — needed reasonable defaults on cooling-off (24h, per CLAUDE.md hint) and export shape (JSON, schema-versioned), but the spec layout was clear-cut. Also full TDD impl + branch + PR body.
3. **#3 design spec only** — implementation needs your aesthetic call. Three directions are laid out with a recommendation.
4. **#5 design spec only** — implementation needs your manual-vs-auto call. Both paths are described; only the operator-UX section differs by your decision.

Each impl branch follows the same shape as the Postgres migration: bite-sized commits, TDD where applicable, no shortcuts.

---

## 2. #2 — Rate-Limit Persistence (shipped)

### What changed

The in-memory `Map<string, number[]>` in `src/lib/rate-limit.ts` is gone. Replaced by a Postgres-backed sliding-window log in a new `auth_throttle` table. Same `5 requests / 15 min / per email` policy.

### Why it matters

Fluid Compute spins up multiple Function instances under load. Each had its own in-memory Map, so an attacker hitting 5 emails to instance A and 5 to instance B got 10 sends instead of the intended 5. Now they all share one Postgres table — same policy, durable across restarts and instances.

The generic per-IP wrapper in `src/lib/request-rate-limit.ts` (used by `/api/photos/upload`, `/api/photos/[id]/analyze`, `/api/generate-posts`) is migrated to use the new async helper, so those endpoints also benefit.

### Files touched (8 modified, 1 deleted)

- **New:** `src/lib/auth/throttle.ts` (the new module), `src/lib/auth/__tests__/throttle.test.ts` (10 new tests), `src/db/migrations/0001_sharp_wolfpack.sql` (auto-generated)
- **Modified:** `src/db/schema.ts` (auth_throttle table), `src/lib/auth.ts` (await new function), `src/lib/request-rate-limit.ts` (migrated), 3 API routes (await rateLimitRequest), `.pr-body-rate-limit.md` (PR draft)
- **Deleted:** `src/lib/rate-limit.ts`

### Test coverage

10 new tests for `throttle`: window semantics, idempotency at the limit, cleanup, cross-key isolation, case-insensitivity, generic helper, default-time fallback. **All 125 tests green** on this branch.

### Migration applied locally?

Yes. `npm run db:migrate` succeeded on Neon dev. Production starts clean and applies on first deploy.

### What you need to do

1. Open the PR using the URL above (or paste from `.pr-body-rate-limit.md` into the GitHub UI).
2. Smoke-test: try requesting 6 magic links for `admin+throttle@example.com` within 15 minutes. Resend dashboard should show 5 sends, not 6.
3. Merge.

### Spec + plan

- Spec: [docs/superpowers/specs/2026-05-12-rate-limit-persistence-design.md](../superpowers/specs/2026-05-12-rate-limit-persistence-design.md)
- Plan: [docs/superpowers/plans/2026-05-12-rate-limit-persistence.md](../superpowers/plans/2026-05-12-rate-limit-persistence.md)

---

## 3. #4 — GDPR Export + Deletion (shipped)

### What changed

Client-facing self-service for two GDPR rights:

- **Export my data** — one click downloads a schema-versioned JSON file with the entire client's data (user + client profile + photos + posts + active deletion-request status).
- **Delete my account** — 24-hour cooling-off window. Client clicks → row in new `deletion_requests` table → email with cancel link → hourly cron sweeps and runs the actual deletion (audit log → blob cleanup → DB delete via FK cascade).

The admin "delete user" endpoint is refactored to share the same `deleteUserAccount` core, so admin deletions now also clean up Vercel Blob files (previously orphaned them).

### Files touched (lots)

- **New:** 5 modules in `src/lib/account/`, 5 test files (~40 new tests), `/dashboard/account` page, three UI components (export button, delete button, banner), public cancel-link route, friendly Dutch confirmation page, hourly cron route. Full list in `.pr-body-gdpr-export-deletion.md`.
- **Modified:** `src/db/schema.ts` (new `deletion_requests` table), `vercel.json` (new cron), admin delete-user route (refactored), main dashboard page (banner mount).

### Test coverage

48 new tests covering: export shape, exclusions, tenant isolation, deletion-request CRUD, cancel-by-token, find-due, deletion logic (audit-first, FK cascade, blob fail-counting), email composer + escaping, cron sweep. **163 tests green** on this branch.

### Migration applied locally?

Yes. The deletion_requests table is now present in your Neon dev DB.

### What you need to do

1. **Merge #2 first** — the migration-number conflict described in §5 below.
2. After merging #2, the rebase steps in `.pr-body-gdpr-export-deletion.md` apply this branch's `0001_*.sql` migration as `0002_*.sql`.
3. Smoke-test: sign in as a test client, upload a photo, generate posts, approve one. Visit `/dashboard/account`. Click "Download mijn gegevens" — JSON should download. Click "Account verwijderen" — confirmation modal, banner appears, email arrives. Click cancel link — banner disappears.
4. Merge.

### Spec + plan

- Spec: [docs/superpowers/specs/2026-05-12-gdpr-export-deletion-design.md](../superpowers/specs/2026-05-12-gdpr-export-deletion-design.md)
- Plan: [docs/superpowers/plans/2026-05-12-gdpr-export-deletion.md](../superpowers/plans/2026-05-12-gdpr-export-deletion.md)

---

## 4. #3 + #5 — Decisions you need to make

Both specs are written and pushed (`docs/part-a-design-specs` branch). Read them; come back here with your call.

### Decision 1 — Attention List aesthetic (#3)

See §3a of [docs/superpowers/specs/2026-05-12-attention-list-design.md](../superpowers/specs/2026-05-12-attention-list-design.md). Three directions:

- **A — Operator console** (my recommendation). Sober, dense, terminal-adjacent. Inter + JetBrains Mono.
- **B — Editorial brief.** Magazine-style with serif display face. Subtle reveal motion.
- **C — Bento dashboard.** Asymmetric tile grid.

I recommend A because you're one operator, not a marketer browsing a SaaS dashboard. Operator-console rewards repeated daily use; bento and editorial are more for "show off the product" than "what fires need putting out before my 10am call."

### Decision 2 — Publisher publishing model (#5)

See §2 of [docs/superpowers/specs/2026-05-12-publisher-design.md](../superpowers/specs/2026-05-12-publisher-design.md). Three options:

- **A — Manual publish-from-queue** (my recommendation). Approved posts queue at `/admin/queue`; you click "Publish now" per post.
- **B — Fully automatic.** Cron publishes at `publishAt` automatically.
- **C — Hybrid.** Manual for new clients, auto for proven ones. Adds a `clients.publishMode` column.

I recommend A for v1, with a planned migration to C in 6-8 weeks. Reasoning is laid out in the spec. The asymmetry — a bad post going live is much worse than a delayed post — argues for keeping humans in the loop until failure modes are understood.

### Why I didn't just pick

These two decisions shape weeks of operations and product positioning. Picking unilaterally overnight would have been overreach. CLAUDE.md §11 ("when something is fuzzy, say so") and the brand-voice rule that defaults to manual review BOTH point toward asking rather than deciding.

If you want me to just go ahead and pick A on both: that's the right call by my reasoning. But you should know I picked, not have it happen silently.

---

## 5. ⚠️ Migration-number conflict between #2 and #4

This is the only mechanical thing you have to handle. Both impl branches were based on `feat/postgres-migration` so they don't share each other's changes. As a result, both branches add a Drizzle migration numbered `0001_*.sql`:

- `feat/rate-limit-persistence` → `0001_sharp_wolfpack.sql` (auth_throttle table)
- `feat/gdpr-export-deletion` → `0001_early_alex_power.sql` (deletion_requests table)

### Resolution sequence

1. Merge **`feat/rate-limit-persistence`** to `main` first. Production gets `0001_sharp_wolfpack.sql`.
2. On the `feat/gdpr-export-deletion` branch, rebase onto the new `main`:
   ```
   git checkout feat/gdpr-export-deletion
   git fetch origin
   git rebase origin/main
   ```
3. The rebase will keep both migrations side-by-side. Drizzle would barf on two `0001_*.sql` files; rename:
   ```
   git mv src/db/migrations/0001_early_alex_power.sql src/db/migrations/0002_early_alex_power.sql
   ```
4. The `meta/_journal.json` and `meta/0001_snapshot.json` from this branch also need updating. Easiest path:
   ```
   rm src/db/migrations/meta/0001_snapshot.json
   # Edit _journal.json: change the idx from 1 to 2, rename to match
   npm run db:generate  # should re-snapshot as 0002 since 0001 is already history
   ```
   Or, more conservatively: just commit the rename and let Drizzle regenerate on next pulse — verify locally before pushing.
5. `git commit --amend` (or new commit) — push the rebased branch (force-with-lease).
6. Merge.

### Production DB state

Production is currently fresh (no migrations applied yet — this is greenfield, no users). When you deploy, Drizzle will apply `0001`, then `0002`, both succeed, table state matches schema. No data migration needed because there's no data.

### Dev DB state

Your Neon dev DB has both tables already applied (I ran `npm run db:migrate` on each branch). If you want a clean slate before merging, run `npm run db:studio` and drop the tables (`auth_throttle` and `deletion_requests`) manually, then re-migrate after the merge. Or just leave it — both tables are additive, no conflict.

### Why this happened

Branching strategy. Each Part A improvement was branched off `feat/postgres-migration` (the same base) so they'd be independently mergeable. That's the right strategy long-term — the cost is migration renumbering. The alternative would have been chaining branches (#4 off #2), which would have forced merge order. Trade-off acknowledged.

---

## 6. Branches summary

```
main
└── feat/postgres-migration              [from previous handoff, still pending merge]
    ├── feat/rate-limit-persistence      [SHIPPED — 7 commits ahead]
    ├── feat/gdpr-export-deletion        [SHIPPED — 12 commits ahead]
    └── docs/part-a-design-specs         [#3 + #5 specs — 1 commit ahead]
```

All four branches are pushed to `origin`.

---

## 7. What's NOT done

Honest list of things I did NOT do tonight, in case you expected differently:

- **Did not implement #3** (Attention List). Pure UI work; aesthetic decision needed; ~2-3 days when started.
- **Did not implement #5** (Publisher). Decision needed; ~2-3 weeks when started (sized as 3 sub-plans).
- **Did not extract the `Db` type alias** to a shared file. The handoff explicitly said "do this as a separate refactor once branches land" — followed that guidance.
- **Did not touch `.env` files.** Per project rules, that's a human edit. The Postgres handoff already noted `DATABASE_URL` needs to be there.
- **Did not invoke the `frontend-design` skill** for #3. It's an interactive skill requiring user input. Captured the three aesthetic options for you to pick from in the spec instead.
- **Did not invoke the `brainstorming` skill** explicitly for the design specs. With you asleep there's no one to brainstorm with. I wrote the specs as if I had brainstormed — with explicit decision tables, alternatives considered, and recommendation rationale. If you want a different option in any spec, all the supporting reasoning is in §2 of each so you can override informed.
- **Did not open PRs via `gh`** because you don't have it installed. PR body drafts are committed at the repo root (`.pr-body-rate-limit.md`, `.pr-body-gdpr-export-deletion.md`).
- **Did not run the Vercel `vercel.json` cron addition through a real Vercel deploy** because there is no Vercel project linked yet (per the previous handoff). The `vercel.json` change will activate when you eventually deploy.
- **Did not implement #5a OAuth + tokens despite Stefan having done the Meta setup work.** Spec is detailed enough that this could start any day; but the manual-vs-auto decision should land first since it shapes the operator-UX section.

---

## 8. Notable observations from the codebase

These are not action items — just things worth knowing.

### The `Db` type alias is now quintuplicated

Files containing the same `type Db = PgDatabase<...>` block:

- `src/lib/posts/repository.ts`
- `src/lib/alerts/check-stale-posts.ts`
- `src/lib/alerts/check-regen-limits.ts`
- `src/lib/auth/throttle.ts` (on `feat/rate-limit-persistence`)
- `src/lib/account/{export,deletion-request,delete,process-deletions}.ts` (on `feat/gdpr-export-deletion`)

That's 8 copies of the same type when both branches merge. A 30-line follow-up branch can move it to `src/db/types.ts`. Don't do it as part of #3 or #5 — keep that branch focused.

### The admin page (`src/app/admin/page.tsx`) is currently a raw table

That table is what #3 will replace. Not broken, just unloved.

### The architecture review you wrote (in untracked `docs/architecture-review-2026-05-11.md`) and the security/dashboard/image report identify all the same issues already addressed earlier this week or being addressed in Part A

So those untracked docs are essentially historical context — they don't change priorities. Keep them or `git rm` them; they don't block anything.

### Stefan's Meta setup doc (`docs/meta-setup.md`) is excellent

If/when you decide on #5, the OAuth + token storage plan can be written directly against that doc — you've already proven out the test flow end-to-end. The publisher spec §3b references your meta-setup.md by name.

---

## 9. Suggested first prompt when you start the next session

Pick one of these depending on what you want to do first:

**If you want to merge what's already done:**
> Walk me through merging the four Part A branches: `feat/postgres-migration`, `feat/rate-limit-persistence`, `feat/gdpr-export-deletion`, `docs/part-a-design-specs`. There's a migration-number conflict between #2 and #4 — handle it for me. Run smoke tests as we go.

**If you want to pick the aesthetic + ship #3:**
> Read `docs/superpowers/specs/2026-05-12-attention-list-design.md`. I picked aesthetic Option A. Use `writing-plans` to produce the bite-sized plan. Then use `subagent-driven-development` to execute it.

**If you want to pick the publishing model + start #5a:**
> Read `docs/superpowers/specs/2026-05-12-publisher-design.md`. I'm picking Option A from §2. Use `writing-plans` to produce the bite-sized plan for **Plan #5a (OAuth + token storage)** only. We'll iterate.

**If you want me to just pick:**
> Pick the most defensible option in §3a of the Attention List spec and §2 of the Publisher spec. Then start #3 implementation.

---

## 10. Quick state-of-the-world

```
git log --oneline main..feat/postgres-migration       → 1 commit (handoff doc)
git log --oneline feat/postgres-migration..feat/rate-limit-persistence  → 7 commits
git log --oneline feat/postgres-migration..feat/gdpr-export-deletion    → 12 commits
git log --oneline feat/postgres-migration..docs/part-a-design-specs     → 1 commit

npm test     → green on all four branches (115 on base, 125 on #2, 163 on #4)
npm run build → green on #2 and #4
npx tsc --noEmit → green on all four
```

That's everything. Tests pass, builds pass, branches are pushed, PR bodies are written, two design decisions are waiting on you.
