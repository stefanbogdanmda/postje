# Database & Data Layer Audit

> Audit date: 2026-05-18
> Auditor: Builder 1 (swarm agent)
> Scope: Schema design, migrations, query patterns, data integrity, performance, and production-readiness gaps.

---

## 1. Schema Overview

**10 tables** defined in `src/db/schema.ts`, backed by Neon Postgres via Drizzle ORM:

| Table | Purpose | Row volume estimate |
|-------|---------|---------------------|
| `users` | People (clients + admin) | 10s |
| `clients` | Business profiles (1:1 with user) | 10s |
| `photos` | Uploaded client photos with AI analysis | 100s |
| `posts` | Generated social media posts | 1000s |
| `accounts` | Auth.js OAuth account links | 10s |
| `sessions` | Active login sessions | 10s |
| `verificationTokens` | Magic link tokens (hashed) | Transient |
| `auth_throttle` | Rate-limit log for magic-link sends | Transient |
| `deletion_requests` | Scheduled account deletions | Very few |
| `deletion_audit_log` | Permanent record of deleted accounts | Very few |
| `meta_connections` | Encrypted Meta page-access-tokens | 10s |

---

## 2. What's Working Well

### 2.1 Schema design
- Clean separation: `users` (identity) vs `clients` (business profile) vs `posts` (content).
- All client data correctly tagged with `clientId` — every query filters by it.
- Proper foreign keys with `ON DELETE CASCADE` propagation from `users` down through `clients`, `photos`, `posts`, `sessions`, `accounts`.
- Unique constraint `posts_client_date_platform_idx` prevents duplicate posts per client/date/platform.
- Meta access tokens encrypted at rest with AES-256-GCM (`src/lib/meta/crypto.ts`).
- `deletion_audit_log` preserves accountability after user data is deleted (GDPR-aligned).

### 2.2 Migration history
- 4 clean, additive-only migrations (0000–0003). No destructive operations.
- Each migration adds tables or indexes without altering existing columns.
- Drizzle journal is intact and versioned.

### 2.3 Query patterns
- Repository pattern cleanly separates DB access from business logic.
- Database type abstracted (`Db` type alias) so tests use PGlite while production uses Neon.
- Transactions used correctly for atomic operations (e.g., `replacePostsForOpenDays`, `insertPosts`).
- `SERIALIZABLE` isolation level with retry for the auth throttle — excellent concurrency handling.
- Optimistic concurrency in `approvePost`/`rejectPost`: WHERE clause checks current status, `assertChanged` detects stale updates.
- All timestamps use `withTimezone: true` — no timezone bugs.

### 2.4 Security
- No raw SQL — all queries use Drizzle's query builder (parameterized by default).
- Secrets in env vars, not code.
- Rate limiting uses persistent DB storage (survives cold starts, works across instances).
- Blob deletion is best-effort during account deletion — failures counted but don't block.

---

## 3. Production-Readiness Issues

### 3.1 CRITICAL — No down migrations

**Problem:** All 4 migrations are forward-only SQL files. There are no rollback/down scripts. If a migration introduces a bug, there is no automated way to revert.

**Impact:** A bad migration in production could leave the database in an unrecoverable state without manual intervention.

**Recommendation:**
- Drizzle Kit doesn't natively generate down migrations. For production safety, maintain a companion `down.sql` file for each migration, or use a tool like `node-pg-migrate` alongside Drizzle for rollback support.
- At minimum, document the manual rollback steps for each migration in a `migrations/README.md`.

### 3.2 CRITICAL — `publishAt` uses local time, not UTC

**Problem:** In `repository.ts:buildPublishAt()` (line 93–97):
```ts
return new Date(year, month - 1, day, hour, minute, 0, 0)
```
This constructs a `Date` using the **server's local timezone**. On Vercel (UTC), this means "08:00" is interpreted as 08:00 UTC, not 08:00 Amsterdam time. Posts will publish ~1-2 hours early for Dutch clients.

**Impact:** Posts publish at the wrong time for every client.

**Recommendation:**
- Store an explicit timezone per client in the `clients` table (default: `"Europe/Amsterdam"`).
- Use a timezone-aware library (e.g., `date-fns-tz` or `Intl.DateTimeFormat`) to compute `publishAt` in the client's timezone.

### 3.3 HIGH — `auth_throttle` table grows unbounded

**Problem:** Old throttle rows are only cleaned up when the **same key** makes a new request (`throttle.ts` line 62–67). If an email is rate-limited once and never used again, its rows persist forever.

**Impact:** Table bloat over time. Not critical at current scale, but becomes a problem as client count grows.

**Recommendation:**
- Add a cron job that runs `DELETE FROM auth_throttle WHERE "requestedAt" < NOW() - INTERVAL '1 hour'` daily.
- Alternatively, add a TTL-based cleanup pass to the existing `check-alerts` cron.

### 3.4 HIGH — No index on `photos.clientId`

**Problem:** The `photos` table has no index on `clientId`. Queries like `WHERE clientId = ?` (used in `generate-posts`, `delete.ts`, `export.ts`) do full table scans.

**Impact:** Performance degrades as photos accumulate. With hundreds of photos per client across many clients, this becomes noticeable.

**Recommendation:**
- Add an index: `CREATE INDEX photos_clientId_idx ON photos ("clientId");`
- Update the schema definition in `schema.ts` to include the index.

### 3.5 HIGH — `posts.photoId` FK has no ON DELETE strategy

**Problem:** In schema.ts line 105:
```ts
photoId: text("photoId").references(() => photos.id)
```
No `onDelete` action is specified (defaults to `NO ACTION`). If a photo is deleted while a post references it, the DELETE will fail with a FK violation.

**Impact:** Cannot delete individual photos without first nullifying all post references. The cascade from `clients` works (deletes all photos and posts together), but standalone photo deletion is blocked.

**Recommendation:**
- Change to `onDelete: "set null"` — if a photo is deleted, posts keep their content but lose the photo reference.
- Requires a migration to `ALTER TABLE posts DROP CONSTRAINT ..., ADD CONSTRAINT ... ON DELETE SET NULL`.

### 3.6 HIGH — `createClient` action is not transactional

**Problem:** In `src/app/admin/clients/actions.ts`, user creation and client creation are separate, non-transactional operations (lines 49–79). If client creation fails, a manual `DELETE` is attempted, but if that also fails, an orphan user row remains.

**Impact:** Risk of orphan user rows in the database. Edge case, but can happen under network or DB failures.

**Recommendation:**
- Wrap both inserts in a single `db.transaction()`.

### 3.7 MEDIUM — No `updatedAt` auto-update mechanism

**Problem:** The `clients` and `posts` tables have `updatedAt` columns, but they are only updated when application code explicitly sets them. There is no database trigger or Drizzle hook to auto-update `updatedAt`.

**Impact:** If any code path forgets to set `updatedAt`, it silently drifts. Some queries may rely on `updatedAt` for staleness checks.

**Recommendation:**
- Either add a Postgres trigger: `CREATE TRIGGER update_timestamp BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();`
- Or create a Drizzle middleware/wrapper that always sets `updatedAt` on updates.

### 3.8 MEDIUM — `verificationTokens` table has no TTL cleanup

**Problem:** Expired magic link tokens are never deleted. Auth.js creates a row for every magic link email; after expiry, these rows serve no purpose.

**Impact:** Table accumulates dead rows. Not a security risk (tokens are hashed and expired), but adds unnecessary storage.

**Recommendation:**
- Add cleanup to the existing cron: `DELETE FROM "verificationTokens" WHERE expires < NOW()`.

### 3.9 MEDIUM — `sessions` table has no TTL cleanup

**Problem:** Expired sessions persist indefinitely. Auth.js doesn't clean up expired session rows.

**Impact:** Same as verification tokens — dead row accumulation.

**Recommendation:**
- Add to cron: `DELETE FROM sessions WHERE expires < NOW()`.

### 3.10 MEDIUM — Repeated `Db` type alias in every file

**Problem:** The `Db` type alias is copy-pasted identically in 8+ files:
```ts
type Db = PgDatabase<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>
```

**Impact:** DRY violation. If the type needs to change (e.g., adding middleware), every file must be updated.

**Recommendation:**
- Export the `Db` type from `src/db/index.ts` and import it everywhere.

### 3.11 MEDIUM — No connection pool size configuration

**Problem:** In `src/db/index.ts`, the Neon `Pool` is created with default settings:
```ts
const pool = new Pool({ connectionString: databaseUrl })
```
No `max`, `idleTimeoutMillis`, or `connectionTimeoutMillis` are set.

**Impact:** In production on Vercel Fluid Compute (function reuse), the pool may hold more connections than Neon's free tier allows (max ~100 concurrent).

**Recommendation:**
- Set explicit pool limits: `{ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30000 }`.
- Neon serverless handles pooling server-side, but client-side limits prevent runaway connection creation.

### 3.12 MEDIUM — `getConnectionByClient` returns oldest, not newest connection

**Problem:** In `src/lib/meta/repository.ts:83`, `getConnectionByClient` orders by `connectedAt` ascending (Drizzle default). The JSDoc comment says "returns the most recently connected" but it actually returns the **oldest** connection.

**Impact:** If a client reconnects their Meta page, the old (potentially expired) connection is returned instead of the new one.

**Recommendation:**
- Add `.desc()`: `.orderBy(desc(schema.metaConnections.connectedAt))`.

### 3.13 LOW — `as never` type assertion in auth adapter

**Problem:** In `src/lib/auth.ts`, a `as never` type assertion is used on the DrizzleAdapter config to silence a bigint/integer type mismatch between Auth.js and Drizzle.

**Impact:** Tech debt. If the underlying type mismatch causes runtime issues, the assertion hides it.

**Recommendation:** Document as known tech debt. Monitor for Auth.js/Drizzle adapter updates that fix the mismatch.

### 3.15 LOW — `scheduledDate` stored as text, not a date type

**Problem:** `posts.scheduledDate` is `text("scheduledDate")` storing `YYYY-MM-DD` strings. This works but bypasses Postgres date functions and comparisons.

**Impact:** Cannot use native Postgres date arithmetic or range queries with proper date semantics. String comparison works for `YYYY-MM-DD` format, but is fragile if format ever changes.

**Recommendation:**
- Not urgent for v1. If the schema is ever refactored, consider migrating to a `date` column. The existing string format sorts correctly.

### 3.16 LOW — `deletionRequests.completedAt` is never set

**Problem:** In `process-deletions.ts`, the comment on line 27 explains: "we don't call `markDeletionCompleted` before deletion — the `deletion_requests` row is cascade-deleted when the user is removed via FK."

**Impact:** The `completedAt` column is structurally unused. The `markDeletionCompleted` function exists but is never called. This is dead code.

**Recommendation:**
- Either remove `completedAt` and `markDeletionCompleted` entirely, or call `markDeletionCompleted` before deleting the user to preserve audit trail (the cascade currently destroys the request record).

### 3.17 LOW — No database-level CHECK constraints for enum-like columns

**Problem:** Columns like `users.role`, `posts.status`, and `posts.platform` use Drizzle's `enum` option for TypeScript type safety, but no `CHECK` constraint exists in Postgres. Invalid values could be inserted by direct DB access or a bug.

**Impact:** Minimal while all writes go through Drizzle. Becomes a risk if direct SQL scripts are ever used for data fixes.

**Recommendation:**
- Consider adding Postgres `CHECK` constraints for critical enum columns (`status`, `platform`, `role`). Low priority for v1.

---

## 4. Missing for Production

### 4.1 No publisher table/tracking

The system generates and approves posts but has no `publish_log` or `publish_attempts` table to track actual publishing to Meta. The `posts.publishedAt`, `posts.publishError` columns exist but there is no dedicated publishing history.

**Recommendation:** When the publisher engine is built, add a `publish_attempts` table to track each attempt (timestamp, HTTP status, error body, retry count). This is essential for debugging failed publishes.

### 4.2 No database backup strategy documented

Neon provides point-in-time recovery, but there is no documentation of:
- Recovery Point Objective (RPO)
- Recovery Time Objective (RTO)
- How to restore from a backup
- Whether Neon's free tier has backup limitations

**Recommendation:** Document the backup strategy in `docs/` before going to production.

### 4.3 No database monitoring or alerting

No monitoring for:
- Connection pool saturation
- Slow queries
- Table bloat
- Storage usage approaching Neon free tier limits

**Recommendation:** At minimum, add Neon's built-in monitoring dashboard to the operational checklist. Consider adding a health-check endpoint that queries a simple `SELECT 1`.

### 4.4 No seed data for development

The only seed scripts are `seed-admin.ts` and `seed-cafe-de-hoek.ts`. There is no comprehensive seed script that creates a full test dataset (multiple clients, photos, posts in various statuses, deletion requests).

**Recommendation:** Create a `seed:dev` script that populates a realistic development dataset for testing all features.

### 4.5 Schema gaps vs product spec (`docs/social-ai-spec.md`)

The spec describes features that have no corresponding schema support:

| Spec Feature | Schema Status | Priority |
|-------------|---------------|----------|
| **Brand profile** (tone of voice, target customers, personality, banned phrases, example posts) | Not in schema. `clients` table has basic fields but no tone/personality/banned-phrases columns. The AI prompt code in `client-profile.ts` builds a hardcoded profile. | HIGH — the spec calls banned phrases "the moat" |
| **Calibration period tracking** (first 2 weeks per client, manual spot-check flag) | Not tracked. No `calibrationStartDate` or `isCalibrating` column on `clients`. | MEDIUM — needed for Stefan's dashboard attention list |
| **Client subscription/billing status** | Not in schema. Spec says manual billing for v1, so a `subscriptionTier` or `activeUntil` column is not urgent but will be needed to enforce access. | LOW for v1 |
| **Notification preferences** | Not in schema. All emails go unconditionally. | LOW for v1 |
| **Post flagging by clients** | Not in schema. Spec describes a "flag" button on published posts to alert Stefan. No `flaggedAt` or `flagReason` column on `posts`. | MEDIUM — part of Stefan's attention list |
| **Onboarding call recording + transcript** | Not in schema. Spec describes a recorded kickoff call whose transcript feeds the brand profile. | MEDIUM — needed for proper onboarding flow |

### 4.6 Leftover `sqlite.db` file in project root

A `sqlite.db` file (from a prior prototype) exists in the project root. The project now uses Neon Postgres exclusively. The spec originally said "SQLite (migrate to Postgres in v2)" — this migration has already happened.

**Recommendation:** Delete `sqlite.db` and add `*.db` to `.gitignore` if not already present. This file is dead weight and could confuse contributors.

---

## 5. Test Coverage Assessment

Repository tests exist:
- `src/lib/posts/__tests__/repository.test.ts` — covers post CRUD operations
- `src/lib/meta/__tests__/repository.test.ts` — covers Meta connection upsert/query
- `src/lib/auth/__tests__/throttle.test.ts` — covers rate limiting with serializable transactions
- `src/lib/account/__tests__/*.test.ts` — covers deletion pipeline, export, deletion requests

Tests use PGlite (in-memory Postgres) for isolation — this is a strong pattern.

**Gaps:**
- No test for `createClient` atomicity failure
- No test for `publishAt` timezone behavior
- No integration tests verifying FK cascade behavior end-to-end
- No load/stress test for connection pool behavior

---

## 6. Summary

| Severity | Count | Key Items |
|----------|-------|-----------|
| CRITICAL | 2 | No down migrations; `publishAt` timezone bug |
| HIGH | 5 | `auth_throttle` cleanup; missing photo index; `photoId` FK strategy; `createClient` not transactional; brand profile not in schema (spec calls it "the moat") |
| MEDIUM | 8 | No `updatedAt` triggers; token/session cleanup; DRY type alias; pool config; calibration tracking; post flagging; onboarding transcripts; `getConnectionByClient` sort order bug |
| LOW | 7 | `scheduledDate` as text; unused `completedAt`; no CHECK constraints; subscription tracking; notification preferences; `as never` auth adapter assertion; console.error logging full objects |
| Housekeeping | 1 | Delete leftover `sqlite.db` |
| Missing | 4 | Publisher tracking; backup docs; monitoring; dev seed data |

**Overall assessment:** The data layer is well-architected for a v1 SaaS — clean schema, proper tenant isolation, good use of transactions, and solid test coverage with PGlite. The two critical issues (`publishAt` timezone bug and no migration rollbacks) should be fixed before production launch. The brand profile gap (HIGH) is architecturally important — the spec explicitly calls banned phrases "the moat" but the schema has no columns for it. The remaining HIGH items are manageable as part of production hardening.
