# Part A Improvements — Sequencing & Rationale

Created 2026-05-11 from the deep-dive research that identified five operational/reliability improvements to Postje before the first paying client.

This document is the **master sequencing plan**. Each line item below gets its own detailed implementation plan when its turn arrives. Do not try to ship them in one branch.

---

## The five improvements

1. **Postgres migration** — Replace SQLite-on-local-file with Neon Postgres (free tier via Vercel Marketplace).
2. **Rate-limit persistence** — Move magic-link rate limiter from in-memory `Map` to a durable DB table.
3. **Owner Attention List dashboard** — Wire the already-stored `alertedAt` / `regenLimitAlertedAt` / first-seen data into one prioritised "what needs my attention" page for Stefan.
4. **GDPR data export + deletion request** — Client-facing "Export my data" and "Delete my account" flows. Launch blocker per CLAUDE.md.
5. **Publisher path** — Cron-driven publisher that consumes `publishAt` on approved posts and pushes them to Meta (or, at v1, surfaces them in an admin "ready to publish" queue with a manual button).

---

## Why this order

The first three are **dependency-ordered**: each later one is easier once the earlier one lands. The last two are **independent of the DB layer** but still benefit from doing #1 first.

### 1. Postgres first (THIS PLAN)

The launch blocker. Today `src/db/index.ts` opens a local file `sqlite.db`. On Vercel, every function instance gets its own ephemeral disk — writes never persist. Any other improvement built on top of SQLite is theatre: it works locally, breaks silently in prod.

Doing this first means every subsequent plan inherits a real durable database and the matching async repository signatures. Doing it later means re-touching every file the later plans changed.

### 2. Rate-limit persistence

Once Postgres is in place, this becomes ~150 lines: one tiny table, one repository pair, swap one Map for a DB query in `src/lib/auth.ts`. Without Postgres, it's pointless — the persistence layer underneath is also ephemeral.

### 3. Attention List dashboard

The data is already there — `alertedAt`, `regenLimitAlertedAt`, `firstSeenAt`, `publishError` are stamped by the existing alert/publish flows. This plan is pure UI + aggregation SQL. It's not strictly dependent on Postgres, but doing it after means the SQL we write is the SQL that ships. (It's also the first plan that will invoke the frontend-design skill — owner UI counts.)

### 4. GDPR export + deletion request

CLAUDE.md calls GDPR compliance a "launch blocker." The current state has zero client-facing path to export or delete data — only Stefan-as-admin can delete. This is straightforward work: two route handlers, two UI surfaces, one confirmation-email flow. Independent of every other improvement.

### 5. Publisher path

The central product promise. Without it, "approved" posts sit forever. This is the largest of the five and depends on Meta Graph API integration, OAuth, encrypted token storage, and retry semantics. It deserves its own design spec before any plan.

---

## What this doc is NOT

- Not a single mega-plan. The writing-plans skill explicitly says one subsystem = one plan.
- Not a commitment to the order. If revenue conditions change (e.g., a paying client signs up before Postgres lands), publisher may jump the queue and Postgres becomes the immediate parallel work.
- Not a timeline. Estimates per plan, not per sequence.

## How to use this doc

When starting the next improvement: open this doc, identify the next item, write its design spec at `docs/superpowers/specs/YYYY-MM-DD-<name>-design.md`, then its plan at `docs/superpowers/plans/YYYY-MM-DD-<name>.md`.

When the Postgres migration is done (item 1), strike through item 1 in this doc and move on to item 2.

## Cross-reference

| # | Spec | Plan |
|---|---|---|
| 1 | (no separate spec — research notes in this doc + the plan) | `docs/superpowers/plans/2026-05-11-postgres-migration.md` |
| 2 | TBD | TBD |
| 3 | TBD | TBD |
| 4 | TBD | TBD |
| 5 | TBD | TBD |
