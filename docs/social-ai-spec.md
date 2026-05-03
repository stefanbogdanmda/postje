# Social AI — Product Specification v1

Written: 3 May 2026
Owner: Stefan, Arnhem (NL)

## What Social AI Is

A SaaS product that runs social media for small businesses. Clients pay a monthly subscription. The system generates posts using AI, the client approves them in a weekly review, and the system publishes them automatically to Facebook and Instagram (TikTok later).

Stefan operates Social AI as a one-person agency. Each client signs up, gets their own account inside Social AI. Stefan sits above all clients with a management dashboard.

Core promise: "We post for you, professionally, in a way that feels human — for a fraction of what a freelance social media manager costs. You spend ~5 minutes a week reviewing."

## Who It's For

- Small businesses in the Netherlands (initially)
- Owner-operators or small teams
- Industries where social media matters but isn't the core business — restaurants, cafés, dentists, hairdressers, small retail, hospitality
- Customers currently either neglecting social media, or paying €500+/month for a freelancer

## How It Works

### Onboarding
- Client signs up online, pays €150 setup fee
- Basic factual info via form: business name, logo, location, industry, type, products/services
- Stefan schedules a recorded kickoff call (with permission)
- Recording transcribed; AI extracts: tone of voice, target customers, brand personality, things to avoid
- Stefan reviews extracted profile, makes corrections
- Client account is ready to generate content

### Weekly Cycle
- AI generates the week's posts using the client's profile
- Mix of photo-based (when client uploads) and AI-generated standalone content
- Min 3, max 6 posts per week per active platform
- Posts queued for client review at start of week
- Client logs in, reviews in ~5 minutes (longer during calibration)
- Client approves or rejects each post individually. Each rejection allows 3–5 regeneration attempts.
- Approved posts scheduled and published at platform-appropriate times

### Posting Times
- v1: Industry default (bakery → 7am, restaurant → 11am/5pm), overridden by explicit client preference if specified during onboarding
- v2: Engagement-data-driven optimization

### Calibration Period
- First 2 weeks of every new client
- Stefan manually spot-checks all posts even after client approval
- After 2 weeks, if rejection rates are low, normal operations begin
- If rejection rates remain high, calibration extends per client

### Failure Modes

**Client doesn't approve in time:**
- After 24 hours of no approval → Stefan notified
- Posts wait for human resolution (no auto-skip, no auto-publish)
- Stefan reaches out personally
- If a client repeatedly misses approvals → Stefan addresses directly, not algorithmically

**Rejection limit hit on a post:**
- After 3–5 failed regenerations → flagged to Stefan
- Stefan manually retunes the client's profile
- Client is notified that improvements have been made

**Offensive or wrong content posted:**
- Flag button on every published post (in client view) — alerts Stefan immediately
- Cancel button on approved-but-not-yet-published posts
- Delete-after-publish option — removes the post from Meta platforms (requires Meta API integration; v1 enhancement)

## "Feels Human" Engineering — 5 Mandatory Levers

1. Persona-driven system prompts — built from recorded onboarding call transcripts
2. Real example posts in the prompt for AI to imitate
3. Hard constraints — sentence length, syllable limits, emoji rules. Not soft instructions.
4. Manual spot-checks during calibration (Stefan reviews even approved posts in weeks 1–2 of a new client)
5. Per-client banned phrases list — grows over time as Stefan notices AI-isms

The boring parts (banned phrases, manual spot-checks) are not optional. They're the moat.

## Stefan's Dashboard (Agency Side)

v1 = Attention List, not Data Dashboard.

Shows what needs human action right now:
- Clients who hit rejection limits → need profile retuning
- Clients in calibration → manual spot-checks needed
- Clients past 24-hour approval window → personal outreach needed
- Posts flagged by clients → review and resolve
- Notifications when something is genuinely wrong

Charts, analytics, campaign planning, billing dashboards → v2+

## Pricing

| Item | Price |
|------|-------|
| Onboarding (one-time) | €150 |
| Instagram only | €150/month |
| Facebook only | €150/month |
| Instagram + Facebook bundle | €200/month |
| TikTok (future) | +€200/month |

Reference: small business owners in NL pay ~€500/month to a freelancer for similar work. Social AI is at ~40% of that.

Pricing minus running costs (Claude API, hosting, video editor APIs for TikTok) = real profit. Some clients will be more expensive to serve than others.

## Brand Voice (Social AI itself)

Friendly, warm, conversational. Talks like a smart friend who knows social media. Not corporate. Not aggressive. Not sales-y. Consistent across website, dashboard, emails, support replies.

## Tech Stack

- **Language:** TypeScript
- **Framework:** Next.js
- **AI:** Claude API
- **Database:** Drizzle ORM + SQLite (migrate to Postgres in v2)
- **Hosting:** Vercel
- **Scheduled Tasks:** Vercel Cron (n8n was considered but deferred — Vercel Cron is built-in and free)
- **Email:** Resend (free tier)
- **Auth:** Magic link email (no passwords)
- **Repo:** Private GitHub repo `social-ai`

## Budget Constraint (Build Phase)

Until Social AI has its first paying client, the project runs on free tiers and pay-as-you-go services only. No new monthly subscriptions beyond Claude Code Max (already paid).

## Legal & Compliance

GDPR compliance is a launch blocker, not a building blocker.

Required before first paying customer:
- Consultation with Dutch privacy lawyer ("AVG advocaat") — budget €200–500
- Privacy Policy
- Terms of Service
- Data Processing Agreement (DPA) with B2B clients
- Technical features matching legal commitments (data export, deletion, consent tracking)

Building Social AI continues normally until launch. Legal setup happens in parallel, in the weeks before first paid client.

## Out of Scope for v1

Explicitly not building:
- TikTok integration (triggered by IG+FB workflow being validated with paying clients)
- Engagement-based posting time optimization
- Client-facing campaign planner
- Automated billing / invoicing (manual at first)
- Advanced analytics / performance reports
- Self-serve onboarding without kickoff call
- Migrating Zeven, Efeze, Klein Canada into Social AI (decision deferred)

## Reference Material (Not Code to Reuse)

Existing client work — Zeven, Efeze, Klein Canada — is reference material only. Detailed prototypes that taught Stefan what works. Social AI v1 starts from a clean repo.

## Open Questions / Future Decisions

Known unknowns to revisit:
- Whether old client systems eventually migrate into Social AI
- Exact Meta API approval path (Development Mode for first ~25 test users; full review needed later)
- Specific magic-link auth implementation (Auth.js vs Clerk vs custom)
- Video editor API for TikTok
- When to migrate from SQLite to Postgres
- Lawyer-recommended specifics for GDPR compliance
- 24-hour approval timer scope: per-batch or per-post?
- Whether to charge €150 setup fee upfront, after kickoff call, or waive for early customers

End of specification. Living document — updated as decisions evolve.
