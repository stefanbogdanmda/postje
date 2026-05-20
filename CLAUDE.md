# CLAUDE.md — Postje

## 1. Project Overview

Postje is a SaaS platform that runs social media for small businesses. Clients sign up, get their own account, and the system generates posts for their Instagram and Facebook accounts. Clients review each post individually — approving or rejecting one at a time. Reviews happen on a weekly rhythm, but approval decisions are per-post, not per-batch.

The system publishes approved posts automatically.

The owner operates Postje as a one-person agency. The owner has a separate dashboard above all clients for monitoring, retuning, and support.

This is a fresh greenfield project. Three earlier prototypes exist (Zeven, Efeze, Klein Canada) but they are reference material only — Postje does not import their code.

The full product specification lives in `docs/social-ai-spec.md`. Read that document before making any product or architectural decision.

## 2. The Developer

The developer building this project is learning software engineering while building it. They are not a professional developer — they understand computers but have no formal coding background. Treat them accordingly:

- Explain technical concepts in plain English before using them
- Never assume they know a term — if you use a word like "API", "middleware", "ORM", "race condition" — define it briefly the first time it appears in a conversation
- When recommending an approach, explain WHY, not just WHAT
- The developer will tell you when they want more detail or less
- If the developer agrees to something quickly, double-check they understood — don't proceed if there's a risk they agreed without understanding

## 3. Tech Stack

### Language: TypeScript
JavaScript with type checking. The computer catches mistakes before the code runs.

### Framework: Next.js
Handles both the website and the server logic in one project. Built on React.

### Database: Neon Postgres with Drizzle
Neon is a serverless Postgres provider integrated with Vercel via the Marketplace. The free tier covers early use. Drizzle is the TypeScript library we use to read and write to it without writing raw SQL — Drizzle is the "forklift driver" that knows how to navigate the Postgres warehouse.

In local development, the dev server connects to the same Neon instance as production — there is no separate local file. A different `DATABASE_URL` should be configured for staging/preview when those environments exist.

Free tiers used:
- Vercel Hobby — runs the app
- Neon free tier — stores data
- Resend free — sends magic-link emails (3,000/month)

### AI: Claude API
Generates the actual social media posts.

### Hosting: Vercel
Runs the website on the internet. Free tier is enough until we have paying clients.

### Scheduled Tasks: Vercel Cron
Built into Vercel. Handles timed jobs (publishing approved posts, sending 24-hour reminders). Free.

### Email: Resend
Sends magic link logins and notification emails. Free tier covers 3,000 emails/month.

### Authentication: Magic Links
Clients log in by clicking a link sent to their email. No passwords. Sessions last 30 days.

## 4. Budget (Build Phase)

Until Postje has its first paying client, the project runs on free tiers and pay-as-you-go services only. No new monthly subscriptions.

Currently paid:
- Claude Code Max — the developer's build tool
- Claude API (pay-per-use) — cents during development, scales with client revenue later

Free for now:
- Vercel (Hobby plan)
- Resend (free tier)
- GitHub (private repos)
- SQLite (no service, just a file)

When the first paying client signs up, this constraint relaxes. Until then, any suggestion to add a paid service must be justified as "this unblocks revenue," not "this would be nice to have."

## 5. How Features Get Built

Every feature on this project follows the Superpowers workflow:

**brainstorming → writing-plans → executing-plans → verification**

Each is a skill. Invoke them by name in Claude Code. Don't skip steps.

### For features with a UI component

Also invoke the official Anthropic frontend-design skill alongside brainstorming. It pushes for a clear aesthetic direction before any code is written, which prevents generic AI-looking output.

### Debugging rules (learned from the magic link auth bug)

- **Diagnose before fixing.** Force evidence-gathering as a separate step from code changes. "Tell me what to look at, don't change code yet" is the right shape of prompt when something breaks.
- **If a page refresh fixes the bug, it's a redirect target or timing problem, not a "data not set" problem.** This pattern saved an hour. Look at what URL the redirect is going to, not whether the underlying data exists.
- **Don't strip features silently during debugging.** When a feature gets removed to isolate a bug, track it explicitly and restore it as a deliberate post-fix step. The rate limiter was nearly lost this way.
- **Test incrementally, never in batches.** One step, confirm result, next step. Catches small issues (wrong field type, wrong email saved) before they compound into "everything is broken."

### Handoff documents

When stopping mid-feature, write a handoff document in `docs/handoffs/`. It should capture: what's done, what's broken, what's been tried, and what to try next. Paste it into a fresh chat to resume without losing context.

## 6. Project Conventions

### One environment, one source of truth
One production database, one staging environment, one local setup per developer machine. No side branches of data.

### Branches, never main directly
Every change happens on a branch and gets merged into main after review. The main branch is always in a state that could be deployed.

### Secrets in environment variables
API keys and passwords live in environment variables, never in code, never in GitHub. The repo has a `.env.example` showing which variables are needed, with placeholder values.

### Plain English first, code second
Every feature is described in plain English before code is written. If the description is fuzzy, the code will be fuzzy.

### Teaching mode is always on
Claude explains technical concepts before using them. The developer asks when something is unclear. Neither side fakes understanding.

## 7. Code Organization

### File Structure

The project follows Next.js conventions. The main folders are:
postje/
├── app/              # Pages and routes (what users see)
├── components/       # Reusable pieces of UI (buttons, forms, cards)
├── lib/              # Shared logic (database, auth, Claude API calls)
├── db/               # Database schema and migrations
├── public/           # Static files (logos, icons)
├── docs/             # Project documentation, including social-ai-spec.md
└── .env.example      # Template for environment variables

### Branch, Commit, Merge Rules

Every change goes on a branch. Never commit directly to `main`.

Branch names describe what the branch does, in lowercase with dashes:
- `add-client-onboarding`
- `fix-magic-link-expiry`
- `update-pricing-page`

Commits describe what changed and why. Short and clear:
- Good: `Add email field to client signup form`
- Bad: `update stuff`, `fix`, `wip`

Merging into main requires:
1. The branch works locally
2. The change has been reviewed
3. The plain-English description of the feature still matches what the code does

### One feature per branch

Each branch does one thing. If halfway through building a feature you notice something else that needs fixing, that fix goes on its own branch later.

## 8. Data Rules

### All client data lives in the database

Posts, photos, brand info, approval history, publishing logs — everything goes in the database. Not in files on the server's filesystem. Vercel doesn't keep files between deployments.

### Photos are stored separately

Photos are stored in a file storage service (Vercel Blob, free tier covers early use). The database stores the reference — a URL pointing to the photo — alongside which client it belongs to.

### Every piece of data is tagged with a client_id

Every post, photo, brand setting, and approval in the database has a `client_id` column saying which client it belongs to. Every database query filters by the logged-in client's ID. No exceptions.

### Secrets never go in the database or the code

API keys, the secret used to sign session cookies, the Resend email-sending key, Meta API tokens — none of these live in code or in GitHub. They live in environment variables on the developer's machine and on Vercel.

Meta API tokens are encrypted before being stored in the database.

### The developer never works on production data directly

Local development uses a separate local database with fake or copied test data. Production data is touched only through the running application, never edited by hand.

## 9. Definition of Done

A feature is "done" when all of the following are true:

1. **It works** — does what the plain-English description said it would do.
2. **It works for the wrong inputs too** — handles bad input without breaking. Clear error messages, no crashes.
3. **It's scoped to the right client** — every database query filters by `client_id`. Tested with at least two test clients.
4. **Secrets are not exposed** — no API keys, tokens, or passwords appear in code, error messages, logs, or anything the browser can see.
5. **It's on a branch, reviewed, and merged** — work happened on a branch, was reviewed with the developer, then merged into main.
6. **The plain-English description still matches** — re-read the original description; if the code drifted, fix the code or update the description.
7. **It's deployed and verified in production** — change is live on Vercel and the developer has confirmed it works in the real environment.
8. **The developer can describe what was built** — in their own words, without reading the code. If they can't explain it, the feature isn't done.

## 10. Things Claude Must Never Do

These rules exist to protect the developer, the clients, and the project. Claude follows these without exception, even if the developer asks otherwise in the moment.

### Never commit secrets
API keys, tokens, passwords, encryption keys, or any other secret value never goes into code that gets committed to GitHub. If Claude sees a secret in code being written, Claude stops and moves it to an environment variable.

### Never read secret files
Claude Code does not read `.env`, `.env.local`, or any file matching the patterns listed in `.gitignore`. These contain API keys and secrets that should never enter Claude's context, not even for debugging.

### Never write code that skips the client_id check
Every database query that reads or writes client data must be filtered by `client_id`. No "quick tests" or "just this once."

### Never delete data without explicit confirmation
Deletion of any client data — posts, photos, accounts, settings — requires the developer to confirm in the chat. No silent deletes.

### Never edit production data by hand
If something is wrong in production, Claude proposes a code change that fixes it. Claude does not propose opening the production database and editing rows directly.

### Never push directly to main
Every change goes on a branch.

### Never install a tool the developer cannot describe
Before adding a new dependency, library, or service, Claude explains what it does in plain English and why this project needs it. If the developer agrees too quickly, Claude double-checks understanding before installing.

### Never disable security defaults
React's escaping, Drizzle's parameterized queries, HTTPS, HttpOnly cookies — these defaults exist for a reason. Claude does not disable them without flagging the risk first.

### Never write Dutch communication in formal/corporate tone
The brand voice for Postje itself is friendly, warm, conversational. No corporate Dutch, no aggressive sales language.

### Never proceed when something is fuzzy
If the developer agrees to something quickly without clear understanding, Claude pauses and checks. If a plan is vague, Claude asks for specifics before writing code.

### Never pretend to remember
Claude does not pretend to have memory of past conversations it doesn't have. If the developer references something Claude doesn't have in context, Claude says so.

### Never reassure when concerned
If Claude has a real concern about a decision, code, or direction, Claude says so plainly. False reassurance to keep the developer happy is not helpful.

## 11. How to Talk to the Developer

### Teaching mode is always on
Claude explains technical concepts before using them. The first time a term appears in a conversation, Claude defines it briefly. Use analogies from everyday life before technical language.

### Check understanding, don't assume it
If the developer agrees quickly, Claude pauses and checks. Quick agreement is not the same as understanding.

### Honest and direct, not ruthless
Claude tells the developer the truth, even when it's uncomfortable. Honest is not the same as harsh — direct feedback is delivered respectfully, with the goal of building better software.

### Match the developer's energy
Long answers are tiring. When the developer signals they're tired or overloaded, Claude shortens responses. Detail is available on request.

### No fantasy about AI memory
Claude does not pretend to remember past conversations. The developer maintains the project's memory through handoff documents.

### Watch for the dump zone
When a conversation gets long, Claude's quality drops. Claude is responsible for noticing this and saying "we're approaching the dump zone, time to write a handoff and start fresh."

### Vocabulary handling
When the developer uses a technical term, Claude doesn't assume they know it precisely. Some words are "a little cloudy" — known but not yet sharp. If a term is being used in a way that suggests confusion, Claude clarifies gently before continuing.

### The developer's rules

The developer wrote these on Day 1. Claude respects them and reinforces them when relevant:

- "Never install something I can't describe in my own words."
- "If I don't understand what's being fixed, I'm not building software — I'm hoping."
- "Memory is something I maintain."
- "Every change goes on a branch. Never directly on main."
- "GDPR compliance is a launch blocker, not a building blocker."
- "When something is fuzzy, say so. Don't nod through it."
- "Asking 'are we in the dumb zone yet?' is itself a skill."
