# Publisher Path to Meta — Design

**Date:** 2026-05-12
**Feature:** Take approved posts from "scheduled" to "published on Instagram + Facebook" (Part A improvement #5)
**Status:** Design spec — NOT yet implemented. Blocks on Stefan's decision in §2.

---

## 1. What we're building

Today, when a client approves a post, `posts.publishAt` is stamped and... nothing else happens. The approved post sits forever. That's the central product-promise gap: Postje's pitch is "we run your socials," but no actual publishing exists. This branch is the publishing.

The work breaks naturally into three streams, each large enough to be its own implementation plan:

- **Stream A — OAuth + token storage.** Connect a client's Facebook Page + linked Instagram Business account, store the long-lived page token encrypted at rest, refresh as needed. **Doable today** (Stefan's meta-setup.md has the test setup ready) but blocks on getting the App through Meta App Review for `pages_manage_posts` + `instagram_content_publish` if Stefan wants more than ~10 testers. Spec covers this.
- **Stream B — The publisher itself.** The actual API calls to Meta. Same shape regardless of manual vs auto; the decision in §2 only changes who pulls the trigger. Spec covers this.
- **Stream C — Operator UX.** Either an admin "ready to publish" queue with a "Publish now" button (manual model) OR a passive cron + a "publish log" admin view (auto model). Differs by §2 decision; spec describes both.

Existing schema columns `posts.publishAt`, `posts.publishedAt`, `posts.publishError`, and the `status` enum value `failed` were added in earlier sprints in anticipation of this work. Schema additions in this branch are: a `meta_accounts` table (token storage) and a `publish_attempts` table (audit / retry trail).

## 2. THE DECISION — manual or auto

Stefan, this is the only blocking question. Both paths are buildable; they shape three months of operations very differently.

### Option A — Manual publish-from-queue (RECOMMENDED for v1)

Approved posts accumulate in an admin "ready to publish" queue at `/admin/queue` (or a panel on the Attention List). Each row has a "Publish now" button. Stefan reviews the post one last time, clicks publish, the API call fires, status flips to `published` (or `failed`).

**Why this is the recommended starting point:**
- **Bad-post risk asymmetry.** A bad post going live is *much* worse than a delayed post. Reputational damage with a real client > the friction of one click.
- **Stefan learns the failure modes.** First 50 publishes manually = he sees what Meta rejects, what works, what edge cases the AI generates that need fixing in `validatePosts`. With auto, he learns these only when a client complains.
- **Compliance pressure.** Meta is increasingly strict on automated-posting apps. A human-in-the-loop step makes the "automated content" arguments to Meta App Review easier to win.
- **Reversibility.** Manual today, auto in 6 weeks if it's clearly safe, is straightforward. Reverse direction is harder ("Stefan, the AI posted something cringe to your café's IG").
- **Calibration period exists for a reason.** §11 of [docs/social-ai-spec.md](docs/social-ai-spec.md) (if I'm reading the doc correctly) treats new-client onboarding as supervised. The first weeks of publishing should match.

**Downsides Stefan should hear:**
- Stefan is the bottleneck. Vacation, illness, full-calendar = posts stack.
- The product promise to clients (we publish automatically) isn't quite true in this mode.
- At 20+ clients × 14 posts/week, manual review at 30 sec/post = ~2.5 hours/week just clicking publish. Manageable, but real.

### Option B — Fully automatic publishing (HIGHER RISK, HIGHER PROMISE-FIT)

Approved posts publish at `publishAt` without further human input. A cron `/api/cron/publish-due` runs every 5-10 minutes, finds eligible posts, fires the API. Stefan watches the Attention List for failures.

**Why this might be right:**
- It is what the product literally promises.
- At scale, manual click-to-publish doesn't.
- The client already approved the post, so "second human gate" is paternalistic.

**Why I'm not recommending it for v1:**
- The "I approved it but didn't expect that to mean LIVE in 8 hours" gap is real. Clients in early-stage product use are still calibrating expectations.
- Meta failures (rate limit, transient outage, expired token, photo failed to upload) need human triage during the early period — and noticing them requires Stefan watching the Attention List proactively, which he can do tomorrow but not in week one.
- One bad post going live with no chance to recall is the kind of mistake that loses a client permanently.

### Option C — Hybrid (Pre-publish hold for new clients)

Manual for the first N posts of any given client (calibration), then auto. v1 ships A; if Stefan wants C, that's a follow-up that's mostly a schema field (`clients.publishMode: 'manual' | 'auto'` defaulting to `'manual'`).

### Recommendation

**Ship Option A. Plan for migration to Option C over 6-8 weeks.** That's "manual now, auto later for proven clients" — gets the safety + the eventual scalability.

If Stefan picks B, the spec below adapts trivially: the "Stefan clicks publish" path becomes "cron runs every 10 minutes." Everything else (token storage, OAuth, error handling, retry) is identical.

---

## 3. Architecture (assuming Option A; deltas for B noted)

### 3a. New schema

#### `meta_accounts` — encrypted token storage, one row per client × Meta connection

```ts
export const metaAccounts = pgTable(
  "meta_accounts",
  {
    id: text("id").notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    clientId: text("clientId")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    pageId: text("pageId").notNull(),
    pageName: text("pageName").notNull(),
    instagramBusinessId: text("instagramBusinessId"),  // null if FB-only
    encryptedAccessToken: text("encryptedAccessToken").notNull(),  // see §3c
    tokenScopes: text("tokenScopes").notNull(),  // comma-separated list, for audit
    expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }),  // null = never; long-lived page tokens are effectively permanent
    connectedAt: timestamp("connectedAt", { withTimezone: true, mode: "date" }).notNull().$defaultFn(() => new Date()),
    lastUsedAt: timestamp("lastUsedAt", { withTimezone: true, mode: "date" }),
    lastErrorAt: timestamp("lastErrorAt", { withTimezone: true, mode: "date" }),
    lastErrorMessage: text("lastErrorMessage"),
  },
  (t) => [
    uniqueIndex("meta_accounts_client_page_idx").on(t.clientId, t.pageId),
  ]
)
```

#### `publish_attempts` — every API attempt, for retry + audit

```ts
export const publishAttempts = pgTable(
  "publish_attempts",
  {
    id: text("id").notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
    postId: text("postId").notNull().references(() => posts.id, { onDelete: "cascade" }),
    attemptedAt: timestamp("attemptedAt", { withTimezone: true, mode: "date" }).notNull().$defaultFn(() => new Date()),
    attemptedBy: text("attemptedBy").notNull(),  // userId of operator (manual) or 'cron' (auto)
    metaPostId: text("metaPostId"),  // Meta's returned post ID on success
    success: boolean("success").notNull(),
    errorCode: text("errorCode"),   // Meta's error subcode if any
    errorMessage: text("errorMessage"),
    requestDurationMs: integer("requestDurationMs"),
  },
  (t) => [
    index("publish_attempts_post_idx").on(t.postId),
  ]
)
```

`posts.publishError` is preserved as a "most recent error message" denormalized for the Attention List. `publish_attempts` is the full history.

### 3b. OAuth connection flow

Stefan's Meta setup doc already proves out the test path. For a real client, the flow becomes:

1. Client signs in to Postje. Goes to `/dashboard/connect` (new).
2. Clicks "Verbind je Facebook Pagina en Instagram". Redirected to Facebook OAuth dialog (`https://www.facebook.com/v21.0/dialog/oauth?...`).
3. After consent, Facebook redirects to `/api/auth/meta/callback?code=...`.
4. Callback exchanges `code` for short-lived user token via `oauth/access_token`.
5. Exchanges short-lived for long-lived user token (`grant_type=fb_exchange_token`).
6. Fetches `me/accounts` to list the user's Pages.
7. Client picks which Page is for this business (UI step: a one-screen page selector if they have more than one).
8. Fetch the Page Access Token from the long-lived response (`me/accounts` includes per-Page tokens when called with a user token).
9. Fetch `PAGE_ID?fields=instagram_business_account` → may return null if no IG linked. Capture if present.
10. Encrypt token (see §3c). Insert into `meta_accounts`.
11. Redirect to a "verbonden!" success page.

If the client wants Facebook-only and has no IG, that's fine — `instagramBusinessId` is nullable. The publisher checks before each publish.

Required env vars (new):

- `META_APP_ID` — public, OK in client code
- `META_APP_SECRET` — server only
- `META_OAUTH_REDIRECT_URI` — must match what's registered in the Meta App settings
- `META_TOKEN_ENCRYPTION_KEY` — 32-byte hex string for AES-256-GCM (see §3c)

### 3c. Token encryption

Per [CLAUDE.md](CLAUDE.md) §8 ("Meta API tokens are encrypted before being stored in the database") this isn't optional.

Use Node's built-in `crypto`. AES-256-GCM with a per-row IV. Key from env. New module `src/lib/meta/encryption.ts`:

```ts
export function encryptToken(plaintext: string): string
// returns base64(iv:16 || authTag:16 || ciphertext)

export function decryptToken(ciphertext: string): string
```

No external dep needed. The encryption key lives in `META_TOKEN_ENCRYPTION_KEY` env var; on first run, we validate the key is exactly 32 bytes when base64-decoded. If missing, the server refuses to start.

### 3d. Publisher logic

Three modules:

- `src/lib/meta/client.ts` — thin HTTP wrapper around Meta Graph API. One function: `metaFetch(url, options) → Promise<{ok, status, body, headers}>`. Handles `User-Agent`, default timeouts (15s), retry on 429 with backoff respecting `X-Page-Usage`.

- `src/lib/meta/publish.ts` — the actual publish logic:

  ```ts
  export interface PublishDeps {
    fetcher: (url: string, init?: RequestInit) => Promise<Response>
    now: Date
    encryptionKey: string
  }

  export async function publishPostToMeta(
    db: Db,
    postId: string,
    deps: PublishDeps,
    attemptedBy: string
  ): Promise<PublishResult>
  ```

  Steps:
  1. Read the `posts` row + joined `clients` + joined `meta_accounts` for the client.
  2. Decide platform path: Instagram or Facebook.
  3. **Facebook path:** single `POST /{PAGE_ID}/feed` or `POST /{PAGE_ID}/photos` with `message` + `url` (photo). Returns `{ id }`.
  4. **Instagram path:** two-step.
     - `POST /{IG_USER_ID}/media` with `image_url` + `caption` → returns `{ id }` (container).
     - `POST /{IG_USER_ID}/media_publish` with `creation_id=<container_id>` → returns `{ id }` (final post).
     - If the photo isn't reachable at the URL (Vercel Blob URLs are public, so this should always work), Meta returns 400 with a specific error code; we surface that distinctly.
  5. On success: `UPDATE posts SET status='published', publishedAt=now, publishError=null WHERE id=? AND status='approved'`. The status guard prevents double-publishing.
  6. Insert a `publish_attempts` row with `success=true, metaPostId=<returned id>`.
  7. On failure: `UPDATE posts SET publishError=?, status='failed' WHERE ...`. Insert a `publish_attempts` row with `success=false, errorCode/Message=...`.

- `src/lib/meta/oauth.ts` — OAuth code exchange + token-extension helpers. Pure functions, testable with a mocked `fetcher`.

### 3e. UX — Option A manual model

#### New admin route: `/admin/queue` (or a section of the Attention List)

A page listing posts where `status = 'approved' AND publishedAt IS NULL`, sorted by `publishAt` ascending. Each row shows:

- Client business name + linkable
- Platform pill (IG/FB)
- Scheduled time (with "in 2h" / "30m ago" relative formatting)
- Content preview (first 100 chars)
- Photo thumbnail if present
- **"Publish now" button** — calls `publishPostAction` server action

The server action wraps `publishPostToMeta` and reports back to the UI. On success: the row vanishes (now published). On failure: the row turns amber, shows the error message, exposes a "Retry" button.

#### Server Action — `src/app/admin/queue/actions.ts`

```ts
export async function publishPostNowAction(postId: string): Promise<PublishResult>
```

Auth: admin only.

#### Client-facing surface

The client dashboard already shows `publishedAt` on published posts. No new client-facing surface in this branch.

### 3f. UX — Option B auto model (deltas)

If Stefan picks Option B instead:

- No `/admin/queue` page (or it becomes a passive log view, not actionable).
- New cron `/api/cron/publish-due` running every 10 minutes:
  ```sql
  SELECT id FROM posts
  WHERE status = 'approved'
    AND publishAt <= now()
    AND publishedAt IS NULL
  ORDER BY publishAt ASC
  LIMIT 50
  ```
- For each: `await publishPostToMeta(db, id, deps, 'cron')`.
- Failures surface to the Attention List (§3 of `2026-05-12-attention-list-design.md` already accounts for this).
- An "early review window" mechanism: don't publish a post within 15 minutes of approval (gives a "wait, no!" window). Implementation: the cron filter adds `AND approvedAt < now() - INTERVAL '15 minutes'`.

### 3g. Retry semantics

Three classes of Meta error:

| Class | Response | Retry behavior |
|---|---|---|
| **Transient** (5xx, 429, network timeout) | Mark `failed` temporarily; the operator (manual) or cron (auto) retries. Backoff respects `X-Page-Usage` or 5 min default. | Up to 5 retries; after that, status stays `failed` and the Attention List surfaces it for manual attention. |
| **Permanent — token** (190 / OAuthException, expired_token, etc.) | Mark `failed`, set `meta_accounts.lastErrorAt`. Send Stefan an email "client X's token needs reconnection." | Do NOT auto-retry; needs re-OAuth. |
| **Permanent — content** (rejected by Meta — banned phrases, copyright, etc.) | Mark `failed`. The post needs editing or regeneration. | Do NOT auto-retry. |

Distinguishing is by Meta's `error.code` + `error.error_subcode` fields. Implementation lookup table lives in `src/lib/meta/errors.ts`.

## 4. Testing strategy

### Unit tests (Vitest, no Meta API contact)

- `encryption.test.ts` — roundtrip, IV uniqueness, tampering detection (auth tag)
- `oauth.test.ts` — mocked `fetcher`, token exchange path, error path
- `publish.test.ts` — given a mocked `fetcher` returning fixture responses for each Meta API behavior:
  - Successful FB publish → row updated, attempt logged
  - Successful IG publish (two-step) → row updated, attempt logged
  - Transient failure → status=failed, error captured, no metaPostId
  - Permanent token failure → status=failed, meta_account lastErrorAt set
  - Status guard works: a post already `published` does not re-publish
- `errors.test.ts` — Meta error → class mapping

### Integration smoke test (manual, post-deploy, Development Mode app)

Using Stefan's test setup from `docs/meta-setup.md`:

1. Approve a post for `Café Test Arnhem`.
2. Manual model: click "Publish now" in `/admin/queue`. Auto model: trigger the cron with `Authorization: Bearer ${CRON_SECRET}`.
3. Confirm Instagram shows the new post within ~1 minute.
4. Confirm `posts.status='published'`, `publishedAt` stamped, `publish_attempts` row exists with `success=true`.
5. Force a token error by stamping `meta_accounts.encryptedAccessToken = '<garbage>'`. Try again: status flips to `failed`, lastErrorAt set on `meta_accounts`. Email to Stefan if email path implemented (or just Attention List).

### Production smoke (after first real client connection)

Same flow, but real client account. Critical: review the rendered post on the actual IG / FB BEFORE the client wakes up to it. (Manual model makes this natural; auto model needs Stefan to set an alarm for the first scheduled `publishAt`.)

## 5. Files to create or modify

### New files (lots — bigger feature)

| Path | Purpose |
|---|---|
| `src/db/migrations/NNNN_add_meta_accounts_and_publish_attempts.sql` | Auto-generated |
| `src/lib/meta/client.ts` | HTTP wrapper |
| `src/lib/meta/encryption.ts` | AES-256-GCM token encryption |
| `src/lib/meta/oauth.ts` | OAuth helpers |
| `src/lib/meta/publish.ts` | Core publish logic |
| `src/lib/meta/errors.ts` | Meta error code → class mapping |
| `src/lib/meta/repository.ts` | `meta_accounts` + `publish_attempts` queries |
| `src/lib/meta/__tests__/*.test.ts` | Five test files |
| `src/app/api/auth/meta/callback/route.ts` | OAuth callback endpoint |
| `src/app/api/auth/meta/start/route.ts` | OAuth initiator (builds the dialog URL with state token) |
| `src/app/dashboard/connect/page.tsx` | Client-facing connect button + status |
| `src/app/admin/queue/page.tsx` | Manual-model queue (Option A) OR passive log (Option B) |
| `src/app/admin/queue/actions.ts` | `publishPostNowAction` (Option A only) |
| `src/components/admin/publish-button.tsx` | Client component for the manual queue |
| Possibly `src/app/api/cron/publish-due/route.ts` | Only if Option B |

### Modified files

| Path | Change |
|---|---|
| `src/db/schema.ts` | Add the two new tables |
| `vercel.json` | New cron (Option B only) |

## 6. Environment variables

New required:

- `META_APP_ID` — public-safe ID of the Meta App
- `META_APP_SECRET` — server-only
- `META_OAUTH_REDIRECT_URI` — exact URL the OAuth callback lives at; must match what's registered in the Meta App's "Facebook Login for Business" settings
- `META_TOKEN_ENCRYPTION_KEY` — 32-byte key encoded as base64 (NOT hex, base64 is denser and standard for `crypto.randomBytes(32).toString('base64')`)
- `META_GRAPH_VERSION` — defaults to `v21.0`; bumpable without code change

## 7. Explicitly out of scope

- **Stories, Reels, carousels.** v1 is single-image feed posts only. The Meta API supports more; we ship the simple path first.
- **Hashtag suggestions or comment management.** Separate features.
- **Cross-post coordination (post the same content to both IG and FB).** Each platform is its own row in `posts` today, each gets its own `publishAt`. Independent publish attempts. If both succeed, great; if one fails, the other can still go.
- **Insights / analytics from Meta.** Read-only metrics like reach, impressions, engagement — separate "post-publish-feedback" feature, possibly Part B.
- **Editing or deleting a published post via the API.** v1 only creates. If a client wants something taken down, they do it on the platform themselves (or Stefan does it manually).
- **Bulk reconnect.** When tokens expire en masse (rare, but possible after Meta policy changes), there's no admin tool. Each client reconnects via the same `/dashboard/connect` flow they used initially.
- **App Review submission.** Spec'd separately. Until App Review approves `pages_manage_posts` + `instagram_content_publish`, only Stefan + explicitly-added testers can use the publisher. ~10 testers free; ~25 testers paid; unlimited only after App Review. This may shape the rollout: Stefan onboards clients one at a time, adds each as a tester, then submits for App Review once the workflow proves out.
- **Per-client publish policies (e.g. "skip weekends," "never before 9am").** v1 publishes at exactly `publishAt`. The `INDUSTRY_POST_TIMES` config that computes `publishAt` from approval time is already the policy layer.
- **Optimistic UI / live published-state push.** Refresh-on-action is fine for an internal admin tool at v1 scale.

## 8. Open questions for implementation

- **Which version of the Graph API to commit to.** `v21.0` is current as of meta-setup.md. Default to it; gate via env var so a future bump doesn't require a deploy. Meta deprecates ~yearly.
- **Whether to use the `User Access Token` flow or `Business Login` flow for the OAuth step.** Business Login is newer and Meta's preferred path going forward. The meta-setup.md doc references both. Implementation should investigate which gives the cleanest UX for a single-Page client.
- **How to scope the OAuth state token** to prevent CSRF on the callback. Standard CSRF token in cookie + `state` query param; lift the existing pattern Auth.js uses for OIDC if practical, otherwise hand-roll a short-TTL DB-backed `oauth_state` table.
- **Whether to schedule the rate-limited Meta retries with Vercel Queues** (paid beta) or a simpler DB-backed retry queue. Default to DB retry — it's free, and the volume is tiny.
- **Whether to fire test publishes against the real Meta API in CI.** Probably no — Meta heavily rate-limits the test endpoints, and adding the App Secret to CI is a real attack surface expansion. Smoke tests stay manual.
- **Auto-publish "early review window" (Option B)** — if the cron filter is `approvedAt < now() - 15min`, posts approved less than 15 minutes before `publishAt` get a delay-publish. Need to decide: do we honor the original `publishAt` (slightly late) or push the publish forward? Implementation choice; default: honor `publishAt` exactly, publish as soon as the 15-minute filter clears. Add a `pendingPublishUntil` column if more precision is needed; v1 just lets the small slip happen.

## 9. Sequencing for implementation

This is the largest of the four Part A improvements. Sequence the work in three plans:

### Plan #5a — OAuth + token storage (foundation)
- Schema (meta_accounts only — not publish_attempts yet)
- Encryption module + tests
- OAuth start + callback routes
- `/dashboard/connect` UI
- Smoke test: connect a real test account, see it in the DB

### Plan #5b — Publisher core (uses #5a)
- publish_attempts schema
- Meta API client + error mapping
- `publishPostToMeta` core function + tests with mocked Meta
- `/admin/queue` page (manual) OR `/api/cron/publish-due` (auto)
- Smoke test: publish a real test post

### Plan #5c — Retry + token-expiry handling (polish)
- Retry policy implementation
- Token-expiry detection + email to Stefan
- Attention List integration (counts toward "failed posts" section)

Each plan is the size of #2 or #4. Total ~2-3 weeks of careful work.

## 10. Suggested first prompt when ready to start

> Read `docs/superpowers/specs/2026-05-12-publisher-design.md`. I'm picking **Option [A/B/C]** from §2 for the publishing model. Use `writing-plans` to produce the bite-sized plan for **Plan #5a (OAuth + token storage)** only — we ship that first, then iterate on #5b. The spec already laid out the architecture; the plan should turn §3a, §3b, §3c, and the §5a sequencing into 8-12 tasks.
