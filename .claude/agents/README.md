# Postje agent team

Claude Code subagents that act as Postje's leadership + specialist team. Each is a
persona grounded in `docs/social-ai-spec.md` and the rules in `CLAUDE.md`.

## Org chart

```
                        postje-ceo
        (decisions · roadmap · prioritisation · routing)
                            │
   ┌───────────┬───────────┼────────────┬───────────────┬──────────────┐
product-      frontend-    backend-     ai-engineer     qa-security    growth-
strategist    design       platform                                    marketing
(specs,       (UI/UX,      (server, DB, (Claude         (tests,        (acquisition,
 priorities)   brand)       tenancy,     pipeline,       isolation,     ads, copy,
                            cron, Meta)   guardrails)     GDPR, sec)     funnel)
```

## How to use them

These are invoked as Claude Code subagents by their `name`, e.g. ask Claude to
"use the **postje-ceo** agent to decide what we build next", or
"have **postje-ai-engineer** add a regeneration loop".

- Start with **postje-ceo** for any "what/why/should we" question — it decides and
  tells you which specialist owns the "how".
- Then invoke the named specialist for execution.

## Important: subagent nesting

In Claude Code a subagent usually **can't spawn another subagent**. So the CEO
doesn't auto-run its team — it makes the call and hands you (or the top-level
session) a brief naming the right specialist to invoke. The CEO can also **author
new teammates**: a new `.claude/agents/postje-<domain>.md` when a domain isn't covered.

## Conventions every agent follows
- Branch + PR for every change; never push to `main`.
- Secrets only in env; never read `.env*`; every client-data query filters by `client_id`.
- GDPR is a launch blocker; no new paid service until the first paying client.
- Brand voice: warm, friendly Dutch — never corporate.
- Plain English first (the developer is learning); brainstorm → plan → execute → verify.

> Note: new/edited agent files are picked up by Claude Code on its next start —
> they may not appear as invokable agents in an already-running session.
