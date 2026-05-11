# Rate-Limit Persistence — Design

**Date:** 2026-05-12
**Feature:** Move the in-memory magic-link rate limiter into Postgres so it survives restarts and works across Vercel Function instances (Part A improvement #2)
**Status:** Design complete, ready for implementation plan

## 1. What we're building

The current rate limiter in [src/lib/rate-limit.ts](src/lib/rate-limit.ts) is an in-process `Map<string, number[]>` keyed by email address. It works locally but has two structural problems on Vercel:

1. **Each Function instance has its own memory.** Fluid Compute reuses instances across concurrent requests, but a second instance spun up under load has an empty Map. Five fast requests to two different instances bypass the limit entirely.
2. **A redeploy or cold start wipes the counter.** A determined attacker that knows we redeploy daily can reset the limit by triggering a redeploy or waiting one out.

We replace the Map with a single Postgres table. The same sliding-window log semantics are preserved: at most `MAX_REQUESTS` magic-link requests per email in `WINDOW_MS`. The only differences are durability and cross-instance correctness.

## 2. Why these specific choices

| Decision | Choice made | Alternatives considered |
|---|---|---|
| Storage shape | New `authThrottle` table — one row per request | Extend `verificationTokens` (overloads a table with two unrelated concerns); rolling counter (loses the sliding-window property) |
| Algorithm | Sliding-window log (timestamps stored, old ones expired on read) | Fixed window (burst at boundary); token bucket (more code, no extra value here) |
| Cleanup | Inline DELETE inside the same transaction as the read | Separate cron sweep (extra moving part); none (table grows forever) |
| Concurrency | Read inside a transaction with `FOR UPDATE` on the candidate rows | None (race condition: two parallel requests both pass the check); advisory lock (overkill) |
| Key | Lowercased email | Raw email (case bypass); IP (NAT'd users share counters, and the existing limiter is per-email) |
| Generic helper | Keep `isKeyRateLimited(key, max, windowMs)` semantics in a second function, same table | Two tables (extra migration); drop the generic helper (currently unused but keeps the option open) |
| Removal of in-memory module | Delete it entirely | Keep as a wrapper around the DB version (no caller benefits) |

The decision to write a *log* (one row per request) rather than a *counter* matters because the existing code uses sliding-window semantics: at 14:59 you can have used all 5 of your 15-minute budget at 14:00 and the next slot opens at 14:01, not at 15:00. A simple counter would either reset at 15:00 (burst) or need a separate per-second column (more complex than the log).

## 3. Architecture

### 3a. New table

```ts
// src/db/schema.ts addition
export const authThrottle = pgTable(
  "auth_throttle",
  {
    id: text("id")
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    key: text("key").notNull(),            // lowercased email, or future arbitrary key
    requestedAt: timestamp("requestedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("auth_throttle_key_requestedAt_idx").on(t.key, t.requestedAt),
  ]
)
```

One row per request attempt. The index covers both the read (`WHERE key = ? AND requestedAt >= ?`) and the cleanup (`DELETE WHERE requestedAt < ?`).

### 3b. New module: `src/lib/auth/throttle.ts`

Replaces [src/lib/rate-limit.ts](src/lib/rate-limit.ts). Two exports:

```ts
export interface ThrottleDeps {
  db: Db
  now?: Date
}

/**
 * Magic-link throttle: at most MAX_REQUESTS per WINDOW_MS per email.
 * Returns `true` when the request should be rejected.
 * The function records the attempt even if it returns `true` — this matches
 * the in-memory version's behavior (failed sends still count toward the limit,
 * preventing a tight loop of failures).
 */
export async function isMagicLinkRateLimited(
  email: string,
  deps: ThrottleDeps
): Promise<boolean>

/**
 * Generic version. Same semantics, parameterized.
 */
export async function isKeyRateLimited(
  key: string,
  options: { maxRequests: number; windowMs: number },
  deps: ThrottleDeps
): Promise<boolean>
```

Behavior, step by step (for the magic-link version; generic delegates to the same logic):

1. `now ?? new Date()`. Compute `windowStart = now - WINDOW_MS`.
2. Start a transaction.
3. `DELETE FROM auth_throttle WHERE key = lowercased_email AND requestedAt < windowStart` — inline cleanup, only for this key.
4. `SELECT count(*) FROM auth_throttle WHERE key = lowercased_email` — count surviving rows (all in-window after the delete).
5. If `count >= MAX_REQUESTS`: still insert a row with `requestedAt = now`. Commit. Return `true`.
6. Else: insert a row with `requestedAt = now`. Commit. Return `false`.

Why insert even when rate-limited: matches the in-memory version's effective behavior (the existing code pushes the timestamp onto the list and saves it even on the rate-limited path because failed sends still consume the budget — preserving this is important so a broken Resend integration can't be hammered).

Wait — re-reading the existing code: when rate-limited, it does NOT push the new timestamp; it only saves the *cleaned* list. So a 6th request inside the window is rejected and does NOT extend the window. The DB version must match this exactly.

**Corrected step 5/6:**

5. If `count >= MAX_REQUESTS`: do not insert. Commit (the DELETE is still useful to keep the table small). Return `true`.
6. Else: insert a row with `requestedAt = now`. Commit. Return `false`.

This means a hammered user stays at exactly `MAX_REQUESTS` rows in the table; they aren't penalized with a longer window for trying more.

### 3c. Concurrency

Two parallel requests for the same email under high load could both `SELECT count(*) == 4`, both insert, and both succeed — yielding 6 rows for a 5-request limit. Two defenses, in order of preference:

- **Primary:** wrap steps 2-6 in a `SERIALIZABLE` transaction. Drizzle on Neon supports `db.transaction(fn, { isolationLevel: "serializable" })`. The conflict throws on commit; we catch it and retry once. If the retry conflicts again, we conservatively return `true` (rate-limited) so we never under-throttle.
- **Fallback if SERIALIZABLE proves too hot:** an `INSERT ... WHERE NOT EXISTS (SELECT 1 FROM auth_throttle WHERE key=? GROUP BY key HAVING count(*) >= MAX_REQUESTS)` — atomic at the SQL level. Slightly less readable; preferred only if SERIALIZABLE retries become a real cost.

v1 ships SERIALIZABLE. The retry is enough for a magic-link form that gets at most a handful of requests per second from a single attacker.

### 3d. Caller change

[src/lib/auth.ts](src/lib/auth.ts) currently has:

```ts
import { isRateLimited } from "./rate-limit"
// ...
if (isRateLimited(email)) {
  return
}
```

After this change:

```ts
import { isMagicLinkRateLimited } from "./auth/throttle"
import { db } from "@/db"
// ...
if (await isMagicLinkRateLimited(email, { db })) {
  return
}
```

The function `sendVerificationRequest` is already `async`, so the `await` is free.

## 4. Data model changes

### New table

| Column | Type | Default | Purpose |
|---|---|---|---|
| `id` | `text`, PK | UUID | Row identity |
| `key` | `text`, not null | — | Lowercased email (or generic key) |
| `requestedAt` | `timestamp(tz)`, not null | `now()` | When the attempt happened |

### Indexes

| Name | Columns | Purpose |
|---|---|---|
| `auth_throttle_key_requestedAt_idx` | `(key, requestedAt)` | Covers the per-key window read AND the cleanup DELETE |

### No backfill needed

The in-memory Map is empty on every restart anyway. The new table starts empty. Existing clients are unaffected.

## 5. Files to create or modify

### New files

| Path | Purpose |
|---|---|
| `src/db/migrations/NNNN_add_auth_throttle.sql` | Creates the `auth_throttle` table and its index |
| `src/lib/auth/throttle.ts` | Postgres-backed magic-link + generic rate limiter |
| `src/lib/auth/__tests__/throttle.test.ts` | PGlite tests covering the window, idempotency, concurrency-via-isolation |

### Modified files

| Path | Change |
|---|---|
| `src/db/schema.ts` | Add the `authThrottle` pgTable + index |
| `src/lib/auth.ts` | Swap `isRateLimited` for `isMagicLinkRateLimited`; pass `{ db }` |

### Deleted files

| Path | Reason |
|---|---|
| `src/lib/rate-limit.ts` | Replaced wholesale by `src/lib/auth/throttle.ts` |

If any non-auth caller used `isKeyRateLimited` (a search shows none today), they'd need to migrate too. Grep step is part of the plan.

## 6. Constants

```ts
const MAGIC_LINK_MAX_REQUESTS = 5
const MAGIC_LINK_WINDOW_MS = 15 * 60 * 1000
```

These match the existing limits exactly. They live in `src/lib/auth/throttle.ts` (not exported) to keep config close to behavior. If a second policy ever needs them, we revisit.

## 7. Error handling

| Failure mode | Behavior |
|---|---|
| DB connection error during the throttle check | Throw — let the route surface a 500. We do NOT default to "allow" (would let attackers DOS the DB to bypass throttling) and we do NOT default to "deny" (would brick the login form during an unrelated outage). Throwing forces operator visibility; the `sendVerificationRequest` callback already swallows errors silently per Auth.js conventions, so user impact is a silent "we didn't send the email" — same as before. |
| SERIALIZABLE conflict | Retry once. On second conflict, return `true` (rate-limited) — fail closed. |
| Clock skew between client and DB | Irrelevant — we use server time (`new Date()` on the function instance, or the DB's `now()` for the `$defaultFn`). All comparisons happen on server time. |
| Email with mixed case ("Foo@Bar.com" vs "foo@bar.com") | Both normalize to lowercase before keying. Existing in-memory version already does this; we preserve it. |

## 8. Testing strategy

### Unit tests (Vitest + PGlite)

`throttle.test.ts`:

**Window semantics**
- First request returns `false` and inserts a row
- N-th request where N <= MAX returns `false` and inserts
- (MAX+1)-th request inside the window returns `true` and does NOT insert
- A request just outside the window (older than `WINDOW_MS`) is treated as expired and does not count

**Cleanup**
- Old rows for the same key are deleted on the next call for that key
- Old rows for OTHER keys are NOT deleted (per-key cleanup)

**Case insensitivity**
- "Foo@Example.com" and "foo@example.com" share the same counter
- Counter created via lowercased key is found when queried with uppercase variant

**Concurrency** (PGlite is single-connection — concurrency tests are sequential; we test the SERIALIZABLE retry path with a forced abort fixture)
- A `SERIALIZABLE` retry on conflict produces the correct count
- Two parallel calls (simulated via `Promise.all` on a real Neon DB in an integration smoke test, but on PGlite we assert the transaction wrapper code path)

**Failed-send preservation** (the behavioral note from `CLAUDE.md` §5)
- When the caller indicates it threw (we don't actually wire this — kept for documentation), the request still counts. The unit test asserts that the throttle module itself does not differentiate; the *caller* (`sendVerificationRequest`) calls `isMagicLinkRateLimited` BEFORE attempting the send, so the row exists whether the send succeeds or fails. This matches the in-memory version's effective behavior.

**Generic helper**
- `isKeyRateLimited("custom-key", { maxRequests: 3, windowMs: 1000 }, deps)` enforces the requested policy independently of the magic-link policy
- Two different keys do not share counters

### Integration smoke (manual, post-deploy)

1. Pick a throwaway email.
2. POST to `/api/auth/signin/resend` six times within 15 minutes (or run the form 6 times).
3. First 5 attempts: magic-link email arrives. 6th: silent rejection, no email.
4. Wait 16 minutes, try once more — succeeds.
5. SQL: `SELECT count(*) FROM auth_throttle WHERE key = 'throwaway@...'` — should show ≤ 5 rows.

### Production smoke (post-deploy)

After Vercel deploy: send 6 magic-link requests for `stefanbogdanmda+throttle@gmail.com` within 5 minutes; confirm Resend dashboard shows 5 sends not 6; confirm `auth_throttle` row count.

## 9. Environment variables

None added. `DATABASE_URL` is already present and used.

## 10. Explicitly out of scope

- **IP-based throttling.** The existing limiter is per-email; we preserve that. IP throttling is a separate (compatible) layer for the future — it would catch spray attacks across emails, which the current per-email approach does not.
- **Distributed rate limiter (Redis / Upstash).** The Vercel Marketplace has these, but they introduce a paid dependency. Postgres is already paid-for and free-tier sufficient. We revisit if throttle load becomes a hot path (unlikely for magic-link traffic).
- **CAPTCHA on the login form.** Different defense layer, different UX trade-off. Not part of v1.
- **Cron sweep to prune old rows.** Inline DELETE on each request handles cleanup for the keys we actually see. A separate sweep for fully abandoned keys (e.g. one-off attackers who never come back) could trim further, but at v1 traffic the table is bounded by `(distinct attempting emails) × MAX_REQUESTS`. Revisit when monitoring shows the table over ~10k rows.
- **Per-platform separate limits.** One throttle key per email, full stop. No "different limits for the same email logging in from web vs API" — Social AI doesn't have an API surface yet.

## 11. Open questions for implementation

- **`onConflictDoNothing` vs explicit count.** Drizzle supports `.onConflictDoNothing()` but it requires a unique constraint to be useful. We don't want unique on `(key, requestedAt)` because two requests in the same millisecond are legitimately distinct attempts. Stay with explicit count-then-insert under SERIALIZABLE.
- **Whether the SERIALIZABLE retry needs jitter.** Probably not at this traffic level. Implementation chooses; if it becomes a hot path the retry can add `setTimeout(Math.random() * 50)` between attempts.
- **Whether `db.transaction(..., { isolationLevel: "serializable" })` exists on the Neon driver.** Drizzle exposes it for node-postgres; confirm for `neon-serverless`. If not, fall back to an explicit `BEGIN ISOLATION LEVEL SERIALIZABLE` via `db.execute(sql\`...\`)`. Either way, the public function signature is unchanged.
