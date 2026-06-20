# CLAUDE.md — Postje

Engineering guidelines for working in this repository. These standards apply to every change.

## 1. Project Overview

Postje is a SaaS platform that runs social media for small businesses. Clients sign up, get their own isolated account, and the system generates posts for their Instagram and Facebook accounts using the Claude API. Clients review each generated post individually — approving or rejecting one at a time on a weekly rhythm — and the system publishes approved posts automatically via the Meta Graph API.

The product is multi-tenant: a single operator manages many client accounts, with an owner-level dashboard above all clients for monitoring, retuning, and support.

## 2. Tech Stack

| Concern | Choice |
|---|---|
| Language | TypeScript |
| Framework | Next.js (App Router) + React |
| Database | Neon Postgres via Drizzle ORM |
| AI | Claude API (post generation + self-correcting quality loop) |
| Auth | Passwordless magic links (30-day sessions) |
| Email | Resend |
| File storage | Vercel Blob (photo references stored in Postgres) |
| Scheduled jobs | Vercel Cron (publishing, reminders) |
| Hosting | Vercel |
| Tests | Vitest (pglite in-memory Postgres for integration tests) |

## 3. How Features Get Built

Every feature follows a disciplined workflow: **brainstorm → write a plan → execute the plan → verify**. Features with UI start from a deliberate aesthetic direction before any code is written, to avoid generic output.

### Debugging principles

- **Diagnose before fixing.** Gather evidence as a separate step from changing code.
- **If a page refresh fixes the bug, it's a redirect-target or timing problem, not a "data not set" problem.** Look at the redirect URL, not whether the data exists.
- **Don't strip features silently during debugging.** When a feature is removed to isolate a bug, track it explicitly and restore it as a deliberate post-fix step.
- **Test incrementally, never in batches.** One step, confirm, next step — small issues surface before they compound.

## 4. Project Conventions

- **One source of truth.** One production database, one staging environment. No side branches of data.
- **Branches, never `main` directly.** Every change happens on a descriptive branch and is merged into `main` after review. `main` is always deployable.
- **Secrets in environment variables.** API keys and tokens live in env vars, never in code or git. `.env.example` documents the required variables with placeholders.
- **Plain-English spec first.** Every feature is described clearly before code is written; if the description is fuzzy, the code will be too.

## 5. Code Organization

```
postje/
├── src/app/          # Pages, routes, API handlers
├── src/components/   # Reusable UI
├── src/lib/          # Shared logic (database, auth, Claude API, publishing)
├── src/db/           # Drizzle schema and migrations
├── public/           # Static assets
└── .env.example      # Environment variable template
```

Branch names describe their purpose in lowercase-with-dashes (`add-client-onboarding`, `fix-magic-link-expiry`). Commit messages describe what changed and why — short and specific, never `fix`/`wip`. One feature per branch.

## 6. Data Rules

- **All client data lives in the database** — posts, photos, brand info, approval history, publishing logs. Vercel does not persist files between deployments.
- **Photos are stored in Vercel Blob**, with the database holding the reference URL alongside its owning `client_id`.
- **Every row is tagged with `client_id`, and every query filters by it.** No exceptions — multi-tenant isolation is enforced at the query layer and tested with at least two clients.
- **Secrets never go in the database or the code.** Meta API tokens are encrypted before being stored.
- **Production data is touched only through the running application**, never edited by hand.

## 7. Definition of Done

A feature is done when all of these hold:

1. **It works** — does what the spec said.
2. **It handles bad input** — clear error messages, no crashes.
3. **It's scoped to the right client** — every query filters by `client_id`, verified with multiple test clients.
4. **Secrets are not exposed** — no keys, tokens, or passwords in code, errors, logs, or anything the browser can see.
5. **It's on a branch, reviewed, and merged** into `main`.
6. **The spec still matches the code** — if it drifted, one of them is fixed.
7. **It's deployed and verified in production.**

## 8. Hard Rules

These hold without exception:

- **Never commit secrets.** If a secret appears in code, stop and move it to an environment variable.
- **Never read secret files** (`.env`, `.env.local`, or anything matched by `.gitignore`).
- **Never write a query that skips the `client_id` filter** — no "quick tests," no "just this once."
- **Never delete client data without explicit confirmation.**
- **Never edit production data by hand** — propose a code change instead.
- **Never push directly to `main`.**
- **Never disable security defaults** — React escaping, Drizzle's parameterized queries, HTTPS, HttpOnly cookies — without flagging the risk first.
- **GDPR compliance is a launch blocker, not a building blocker** — data export and deletion are first-class features.
