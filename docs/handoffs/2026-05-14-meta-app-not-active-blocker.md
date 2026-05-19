# Handoff — Meta "App not active" blocker

**Date:** 2026-05-14
**Branch:** `feat/publisher-engine`
**Status:** Session ended with the user exhausted and weighing alternatives. No code was changed this session (explicit user constraint).

---

## TL;DR

Three days of trying to test the Meta OAuth flow end-to-end. Got past every gate except the final one: when the user clicks **Connect Instagram / Facebook** in Social AI and gets redirected to Meta, Meta shows **"App not active"** instead of the consent screen. The user is considering pivoting away from Meta entirely (to Ayrshare-style intermediary, GBP, or newsletter product). A decision was deferred to a fresh session.

## What this session actually accomplished

Three deliverables, all docs/config — no code changes:

- **`docs/social-ai-explainer.html`** — one-page visual explainer of the product the user can show to friends. Self-contained HTML, no build needed.
- **`docs/meta-setup.md`** — rewritten end-to-end. Old version walked through fake test accounts; new version is split between "you (Stefan)" steps and "Tommy" steps, with a dry-run mode that uses Stefan's own personal FB account, and a "Send this to Tommy" Dutch copy-paste block at the bottom.
- **`~/.claude/.../memory/project_feature_backlog.md`** — added "Meta Connection Pre-flight Checklist" feature under Client value section. Origin: realized doc-as-onboarding doesn't scale past one friend; this surfaces FB Page + IG Business + linking requirements as in-app UI.

## Current state of the Meta integration

### Done (in Meta dev console)
- App `SocialAi` created (App ID `1661723014871865`, App type Business, Dev Mode)
- Products added: **Facebook Login for Business**, **Instagram** (note: "Pages API" no longer exists as a separate product — Meta consolidated its permissions into FB Login for Business)
- OAuth redirect URI `http://localhost:3000/api/meta/callback` whitelisted (later learned: Meta auto-allows localhost in Dev Mode, so this was technically unnecessary)
- App Settings → Basic partially filled: Privacy Policy URL = Google Doc, Terms = same Google Doc, Category selected
- Stefan listed as Administrator (the user's account name on Facebook is "Emily Jackson" — privacy/handle thing, not a different person)
- Tested "Get Advanced Access" flow on `public_profile` — blocked by missing Privacy Policy URL dialog, then by "Verification required" tag. Did NOT push through; abandoned advanced-access flow.

### Done (on Stefan's personal Facebook)
- Created a real FB Page named **Cafe Arnhem** on his personal account (Page ID `61589719285513`). Used as the OAuth target for the dry run, since fake test accounts had been bot-flagged days earlier when he tried to link two fresh accounts together.
- Tommy Culinair (the real intended first test client) has NOT been touched yet. He still has only a Business Instagram with no Facebook Page. Tommy doesn't need to do anything until the OAuth flow itself is proven working.

### Done (in the project / database)
- `.env.local` now has the full Meta block: `META_APP_ID`, `META_APP_SECRET`, `META_TOKEN_ENCRYPTION_KEY`, `META_OAUTH_REDIRECT_URI=http://localhost:3000/api/meta/callback`, `META_GRAPH_VERSION=v21.0`
- Migration `0003_groovy_wasp.sql` (creates the `meta_connections` table) was applied manually via Neon's web SQL editor. **Important:** `npm run db:migrate` silently fails on this project because `@neondatabase/serverless` driver needs WebSocket support (the `ws` npm package) which is not installed. The drizzle journal still lists 0003, but the actual SQL never runs. **This is a real bug worth fixing on a separate branch** — see "Tech debt" section below.
- The Tommy Culinaire test client row exists in the `clients` table (created previously, before this session). The Meta connection panel renders on his detail page and shows "Not connected".

### The actual blocker
When the user clicks **Connect Instagram / Facebook** on the Tommy Culinaire detail page, the browser correctly redirects to `https://www.facebook.com/v21.0/dialog/oauth?client_id=1661723014871865&...` — but Meta responds with:

> **App not active**
> This app is not currently accessible and the app developer is aware of the issue.
> You will be able to log in when the app is reactivated.

This is **Meta's wording for an auto-suspended app**, not for "missing required fields" (different error). My working hypothesis: Meta auto-suspended the app at some point — possibly when the user attempted "Request advanced access" earlier while compliance fields were blank.

### What was NOT tried before the session ended
- **App icon** (1024×1024) — still empty in App Settings → Basic. Likely required.
- **Real hosted Privacy Policy URL** — the Google Doc URL may not satisfy Meta's automated scraper. Need a real HTML page on a public domain (Vercel/GitHub Pages).
- **Real hosted Terms of Service URL** — same.
- **User data deletion URL** — still empty. Required for GDPR.
- **App domains** field — still empty.
- **Business Portfolio** — not connected.
- **Required actions / Alerts sidebar items** — the user did NOT screenshot these (we asked but the session pivoted to the strategy conversation before they came back).

## The strategy question on the table

The user explicitly raised "should I pivot away from Meta?" near the end of the session. The options laid out, and my recommendation:

1. **Push through Meta** (status quo, more days like today)
2. **Use an intermediary API like Ayrshare** (~$99/mo, skips Meta App Review entirely)
3. **Pivot channel — keep ICP**: newsletters or Google Business Profile. Newsletters lose ICP-fit; GBP is a smaller value than IG/FB for cafés.
4. **Pivot whole product** — not recommended.

**My recommendation given in-session:** Spend ~60 min tomorrow filling ALL Meta compliance fields properly (app icon, real-HTML privacy policy page hosted somewhere, terms, data-deletion URL, app domains). If after that the OAuth still fails with "App not active," that's definitive proof it's not a fields issue, and we switch to Ayrshare with zero second-guessing. ~60-70% chance the fields fix unblocks it.

The user did not commit either way. They closed the session at the "sound right?" check.

## Tech debt accumulated this session

1. **`@neondatabase/serverless` migrations silently fail.** Need to install `ws` and configure `neonConfig.webSocketConstructor = ws` in drizzle.config.ts (or wherever drizzle-kit loads config). Without it, future migrations will keep silently failing and have to be applied manually via Neon's SQL editor. **High priority** — this affects every future schema change.

2. **Privacy Policy / Terms / Data Deletion pages don't exist as hosted HTML.** Even if we go the Ayrshare route, these are still good to have for GDPR. Could be a small static section on the future production website.

3. **The meta-setup doc is now Stefan's playbook, but it assumes things that turned out to be wrong** (Pages API as a separate product no longer exists; localhost auto-allowed without whitelist; the privacy policy gate enforcing in Dev Mode). It's been partially patched mid-session but could use a clean-pass review when the OAuth flow actually works once.

## What the next session should do

### If the user wants to push through Meta one more time
1. Open Meta dev console → SocialAi → Required actions + Alerts sidebars. Screenshot whatever's listed. **This is the first thing to check.** Meta will tell us what they want.
2. Generate a 1024×1024 placeholder app icon (any colored square with "SA" text works). Upload via App Settings → Basic.
3. Deploy a tiny static page somewhere public (Vercel preview, GitHub Pages, even a free site) with three sub-pages: `/privacy`, `/terms`, `/data-deletion`. Plain text legal-ish content; doesn't need to be real-lawyer-grade for dev.
4. Paste those three URLs into Meta's Basic settings, replacing the Google Doc URL.
5. Fill `App domains` with whatever domain hosts the pages above.
6. Save, wait 60 seconds, retry OAuth from Tommy Culinaire client page.
7. **Decision branch:** if the consent screen appears → continue to authorize, screenshot the resulting `meta_connections` row in Drizzle Studio. If still "App not active" → stop pushing on Meta; move to Ayrshare evaluation.

### If the user wants to evaluate Ayrshare
- Sign up for the free tier
- Map the existing Social AI code's expectations (look at `src/lib/meta/` — uses Page tokens + IG Business IDs) onto Ayrshare's API shape
- Estimate the rewrite scope of replacing `src/lib/meta/` with `src/lib/ayrshare/` (probably a few hours given how isolated the meta module is — three commits add it cleanly, look at git log on `feat/publisher-engine`)
- Decide based on that estimate

### If the user wants to discuss pivot at the product level
- Walk through Options 3 + 4 from the strategy section. This needs the user awake and rested; not something to push when they're tired.

## Files touched this session (no code)

- `docs/social-ai-explainer.html` — new, untracked in git
- `docs/meta-setup.md` — rewritten end-to-end (overwrote prior version). Tracked, has modifications.
- `~/.claude/projects/c--Users-stefa-projects-social-ai/memory/project_feature_backlog.md` — appended one entry under "Client value" section

## Important user context for the next agent

- **The user is a learning developer.** Teaching mode required. Define technical terms briefly the first time they appear. CLAUDE.md has full details.
- **The user explicitly forbade code changes during this session.** That constraint may or may not still apply next session — confirm before touching code.
- **The user is exhausted from 3 days of Meta walls.** Don't pile more decisions or steps on them. Lead with the diagnostic step (Required actions + Alerts screenshots), let them respond, then proceed.
- **Tomorrow's session should NOT start by re-explaining what we already did.** This handoff doc is the context. Reference it; don't repeat it.
- **The first test subject is Tommy Culinair** (real friend, Dutch HoReCa business). His IG handle and email haven't been collected yet — he has Business IG but no FB Page. He doesn't get pulled into anything until the OAuth flow is proven on Stefan's own Cafe Arnhem Page.

## Suggested skills for the next session

- **`superpowers:brainstorming`** — if the strategic question (push through Meta vs. Ayrshare vs. pivot) is the focus. Don't jump to implementation.
- **`vercel:deployments-cicd`** — if hosting the privacy/terms/data-deletion pages becomes the next step (quickest path is a tiny static Vercel deploy).
- **`vercel:next-forge`** is NOT relevant here — wrong stack.
- **`research`** (or `research-ops`) — for evaluating Ayrshare vs. alternatives like Later API, Buffer API, Postiz, with current pricing and feature matrices.
- **No TDD skill needed yet** — nothing here requires writing tests; the blocker is config/compliance.

## What this handoff is NOT

- Not a plan. The next session needs the user's input on which path before any plan makes sense.
- Not a status report on the publisher-engine feature as a whole — only on the Meta-OAuth-end-to-end test portion.
- Not a record of what we *learned* about Meta in general — that lives in `docs/meta-setup.md` which was updated during the session.
