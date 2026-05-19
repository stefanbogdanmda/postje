# Security & Authorization Audit

**Auditor:** Builder 2
**Date:** 2026-05-18
**Scope:** Authentication, authorization, session management, encryption, rate limiting, CSRF protection, security headers, input validation, secret management, OWASP Top 10

---

## Summary

- **Authentication is solid:** Magic link flow via Auth.js + Resend is well-implemented with database-backed sessions, rate limiting, and invite-only signup (existing users only).
- **Authorization is consistently enforced:** Every data-touching route uses `requireUser()`, `requireAdmin()`, or `requireClientAccess()` with proper `clientId` filtering on all queries.
- **Encryption is production-grade:** Meta tokens use AES-256-GCM with random IVs and authenticated tags. OAuth state tokens use HMAC-SHA256 with timing-safe comparison and 10-minute TTL.
- **Critical gaps exist:** No security headers configured (CSP, HSTS, X-Frame-Options), no global auth middleware, cron endpoints use non-constant-time secret comparison (severity debatable — see C2 reviewer note), and no structured input validation (Zod) on API request bodies.

---

## Findings

### CRITICAL

#### C1 — No Security Headers Configured

**File:** `next.config.ts:1-7`
**Description:** The Next.js config is empty. No security headers are defined: no CSP, no HSTS, no X-Frame-Options, no X-Content-Type-Options, no Referrer-Policy, no Permissions-Policy.
**Impact:** The application is vulnerable to clickjacking (missing X-Frame-Options/CSP frame-ancestors), MIME-type sniffing attacks, and cannot enforce HTTPS via HSTS. Browsers won't apply any extra security protections.
**Recommendation:** Add a `headers()` function to `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ]
  },
}
```

Add a Content-Security-Policy once inline script usage is audited.

#### C2 — Cron Secret Comparison is Not Constant-Time

**Files:** `src/app/api/cron/check-alerts/route.ts:46`, `src/app/api/cron/process-deletions/route.ts:15`
**Description:** Both cron endpoints compare the Bearer token with `authHeader !== \`Bearer ${CRON_SECRET}\`\``. JavaScript's `!==` operator for strings is not constant-time; it short-circuits on the first mismatched character. This makes the secret vulnerable to timing attacks that can recover the value one character at a time.
**Impact:** An attacker with network access to the cron endpoints could potentially extract the `CRON_SECRET` value via timing analysis.
**Reviewer note:** Reviewer 1 suggests this may be HIGH rather than CRITICAL — Vercel cron endpoints are called by Vercel's own infrastructure, and remote network timing adds enough noise to make exploitation very difficult. Still worth fixing since it's a 5-line change.
**Recommendation:** Use `crypto.timingSafeEqual()` (already used in `oauth-state.ts`):

```typescript
import { timingSafeEqual } from "node:crypto"

function verifyCronSecret(authHeader: string | null): boolean {
  if (!CRON_SECRET || !authHeader) return false
  const expected = Buffer.from(`Bearer ${CRON_SECRET}`, "utf8")
  const actual = Buffer.from(authHeader, "utf8")
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}
```

---

### HIGH

#### H1 — No Global Auth Middleware

**Description:** There is no `middleware.ts` at the project root. Route protection relies entirely on each page/API route calling `auth()`, `requireUser()`, `requireAdmin()`, or `requireClientAccess()` individually. If a developer adds a new `/dashboard/*` or `/admin/*` route and forgets the auth check, it will be unprotected.
**Current pattern:** Dashboard layout (`src/app/dashboard/layout.tsx:13`) checks `auth()` and redirects. Admin pages check `session.user.role !== "admin"` individually.
**Impact:** No defense-in-depth. A single missed check exposes a route.
**Recommendation:** Add a `middleware.ts` at the project root that enforces auth on `/dashboard/*`, `/admin/*`, and `/api/*` (excluding `/api/auth/*`, `/api/account/deletion/cancel`, and `/api/cron/*`). Individual route checks remain as a second layer.

#### H2 — No Structured Input Validation (Zod)

**Description:** API route request bodies are parsed with unvalidated type assertions: `const { userId } = body as { userId: string }` (`src/app/api/admin/delete-user/route.ts:16`). Server actions use `formData.get("email") as string | null` without schema validation. No Zod schemas exist anywhere in the codebase.
**Impact:** Malformed or malicious input could reach business logic. Without schema validation, type safety is not enforced at runtime — the TypeScript types are compile-time only.
**Recommendation:** Add `zod` to dependencies and create schemas for every API endpoint and server action. Example:

```typescript
const deleteUserSchema = z.object({
  userId: z.string().uuid(),
})
const parsed = deleteUserSchema.safeParse(body)
if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })
```

#### H3 — Admin Delete-User Returns 404 for Missing User (Enumeration Risk)

**File:** `src/app/api/admin/delete-user/route.ts:33`
**Description:** When an admin attempts to delete a non-existent userId, the endpoint returns `{ error: "User not found" }` with status 404. This confirms whether a userId exists or not.
**Impact:** Although this is an admin-only endpoint, returning 404 vs 403 reveals user existence. If the admin auth were ever bypassed, this becomes an enumeration vector.
**Recommendation:** Return 403 Forbidden consistently for both "not found" and "not authorized" cases in admin endpoints, or return the same generic response for all failure states.

#### H4 — Console.error Logs May Expose Sensitive Context in Production

**Description:** Multiple files log error details via `console.error()`:
- `src/lib/authorization.ts:91` — logs the full error object for 500 responses
- `src/app/api/admin/delete-user/route.ts:53` — logs userId + error message
- `src/app/api/cron/check-alerts/route.ts:28` — logs pass failure messages
- `src/lib/account/process-deletions.ts:44` — logs userId + error
- `src/app/dashboard/account/actions.ts:44,67,83` — logs error messages

**Impact:** In serverless environments (Vercel), `console.error()` output appears in function logs. If error messages contain stack traces, database details, or internal state, they could be visible to anyone with access to the Vercel dashboard.
**Recommendation:** Replace `console.error()` with a structured logger that redacts sensitive fields. At minimum, ensure error messages logged in production never include full stack traces, database connection strings, or user PII beyond opaque IDs.

---

### MEDIUM

#### M1 — Rate Limiting Keyed by IP Header (Proxy Risk)

**File:** `src/lib/request-rate-limit.ts:5-10`
**Description:** API rate limiting uses `x-forwarded-for` or `x-real-ip` headers to identify the client IP. These headers are set by the reverse proxy (Vercel) but can be spoofed if the app is accessed outside Vercel's proxy chain (e.g., direct function URL access).
**Impact:** An attacker could bypass rate limiting by spoofing the IP header.
**Recommendation:** On Vercel, `x-forwarded-for` is trustworthy. Document this assumption. If the app is ever deployed behind a different proxy, add IP header trust configuration. Consider also rate-limiting by authenticated user ID for logged-in endpoints.

#### M2 — Magic Link Rate Limit Silently Drops Email (No User Feedback)

**File:** `src/lib/auth.ts:45-47`
**Description:** When `isMagicLinkRateLimited()` returns true, the `sendVerificationRequest` callback simply `return`s without sending the email. The user receives no error message — the login page appears to succeed but no email arrives.
**Impact:** Users who hit the rate limit will be confused about why they're not receiving login emails. They may interpret this as the system being broken.
**Recommendation:** While not sending the email is correct, the UX should indicate "we've sent too many emails recently, please wait" rather than appearing to succeed. This requires coordination with the Auth.js flow (may need a custom error page or callback).

#### ~~M3 — No `.env.example` in Repository~~ **RETRACTED**

**Correction:** `.env.example` exists in the repository root (confirmed via `git ls-files`). This finding was a false positive caused by the audit tooling not finding dotfiles. No action needed.

#### M3 — AUTH_SECRET Reused for Multiple Purposes

**File:** `src/lib/meta/oauth-state.ts:16` and Auth.js internal usage
**Description:** `AUTH_SECRET` is used both by Auth.js (for session token signing, CSRF protection) and by the custom OAuth state token HMAC signer. While both uses are for signing, reusing the same key material across different cryptographic contexts weakens the security boundary.
**Impact:** If the key were compromised in one context (e.g., via an Auth.js vulnerability), the OAuth state tokens would also be compromised.
**Recommendation:** Consider deriving separate keys using HKDF: `const oauthStateKey = hkdf(AUTH_SECRET, "oauth-state")`. This keeps a single root secret but produces domain-separated signing keys.

#### M5 — No Form-Level CSRF Protection on Server Actions

**Description:** Next.js Server Actions have built-in CSRF protection via the action ID mechanism (Origin header check), which is enabled by default. However, the non-Server-Action API routes (e.g., `POST /api/admin/delete-user`, `POST /api/generate-posts`) do not have explicit CSRF tokens.
**Impact:** Since these routes check `auth()` (session cookie), they rely on SameSite cookie settings for CSRF protection. If SameSite is not set to `Strict` or `Lax`, cross-origin requests with the session cookie could be forged.
**Recommendation:** Verify that Auth.js sets `SameSite=Lax` (or `Strict`) on the session cookie. Document this as the CSRF protection mechanism for API routes.

---

### LOW

#### L1 — Session MaxAge is 30 Days Without Explicit Refresh Strategy

**File:** `src/lib/auth.ts:83`
**Description:** Sessions last 30 days. Auth.js with database sessions does extend on activity by default, but there's no documented refresh strategy or forced re-authentication for sensitive operations.
**Impact:** A stolen session token remains valid for up to 30 days. For a business SaaS tool managing social media accounts, this is a long window.
**Recommendation:** Consider reducing to 7 days for client sessions, or implement step-up authentication for sensitive operations (Meta connect, account deletion). Document the refresh behavior.

#### L2 — Admin Pages Check Role Individually (Pattern Inconsistency)

**Files:** `src/app/admin/clients/actions.ts:16`, `src/app/api/admin/delete-user/route.ts:11`
**Description:** Some admin routes use `session.user.role !== "admin"` directly, while others use `requireAdmin()` from `authorization.ts`. The inconsistency means some admin routes get the structured error handling of `HttpError` while others use manual response construction.
**Impact:** No security impact (both work), but the inconsistency makes it easier to introduce bugs in future routes.
**Recommendation:** Standardize all admin routes on `requireAdmin()` from `authorization.ts`.

#### L3 — Cookie Configuration Not Explicitly Visible

**Description:** The session cookie configuration (name, SameSite, Secure, HttpOnly, Path) is not explicitly set in the Auth.js config. Auth.js applies sensible defaults (`HttpOnly`, `SameSite=Lax`, `Secure` in production), but the security-critical settings are implicit rather than explicit.
**Recommendation:** Add explicit cookie configuration to the NextAuth config for documentation and auditability:

```typescript
cookies: {
  sessionToken: {
    name: "__Secure-next-auth.session-token",
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
    },
  },
},
```

---

## Positive Security Patterns Found

These are aspects of the codebase that are already well-implemented:

1. **Invite-only signup:** The `signIn` callback (`src/lib/auth.ts:94-105`) rejects any email not already in the `users` table. Open registration is impossible.
2. **Consistent client isolation:** Every query filters by `clientId`. The `requireClientAccess()` function enforces this at the authorization layer.
3. **AES-256-GCM encryption for Meta tokens** (`src/lib/meta/crypto.ts`): Random IV, authenticated tag, proper key length validation.
4. **HMAC-SHA256 signed OAuth state tokens** (`src/lib/meta/oauth-state.ts`): Time-boxed (10 min), nonce for replay protection, `timingSafeEqual()` for signature verification.
5. **Database-backed rate limiting with SERIALIZABLE isolation** (`src/lib/auth/throttle.ts`): Prevents race conditions, fails closed on errors.
6. **No `dangerouslySetInnerHTML`** anywhere in the codebase.
7. **All database queries use Drizzle ORM** — no raw SQL, no string concatenation in queries.
8. **Generic error messages** in public endpoints (account deletion cancel always redirects, auth errors say "Unauthorized" not "User not found").
9. **Admin cannot delete other admins** (`src/app/api/admin/delete-user/route.ts:36-40`).
10. **Double auth check on Meta OAuth callback** — verifies admin role in both the connect-start and callback endpoints.

---

## Missing Features for Production

| Feature | Priority | Description |
|---------|----------|-------------|
| Security headers | **Critical** | CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy |
| Global auth middleware | **High** | Defense-in-depth route protection for `/dashboard/*`, `/admin/*`, `/api/*` |
| Zod input validation | **High** | Schema validation on all API request bodies and server action inputs |
| ~~`.env.example`~~ | ~~**High**~~ | ~~RETRACTED — file exists in repo~~ |
| Structured logging | **Medium** | Replace `console.error()` with a logger that redacts sensitive fields |
| Meta token refresh/revocation | **Medium** | Long-lived tokens (60 days) have no refresh or revocation mechanism |
| Session audit logging | **Medium** | Log session creation, expiry, and unusual patterns |
| Rate limit per authenticated user | **Medium** | Complement IP-based rate limiting with user-based limits |
| Cookie config documentation | **Low** | Make Auth.js cookie settings explicit in config |
| Key separation (HKDF) | **Low** | Derive separate signing keys from AUTH_SECRET |

---

## Recommended Next Steps (Prioritized)

1. **Add security headers to `next.config.ts`** — single file change, immediate security improvement
2. **Fix cron secret timing attack** — replace `!==` with `timingSafeEqual()` in both cron routes
3. **Add `middleware.ts`** — enforce auth on `/dashboard/*` and `/admin/*` as defense-in-depth
4. **Add Zod** — install the package and create validation schemas for API endpoints
5. **Standardize admin auth** — migrate all admin routes to use `requireAdmin()` from authorization.ts
6. **Verify cookie SameSite setting** — confirm Auth.js defaults are appropriate, then document
7. **Add structured logging** — replace `console.error` with a production-safe logger
8. **Implement Meta token refresh** — tokens expire after 60 days with no automatic renewal
9. **Add rate limiting by user ID** — for authenticated endpoints, limit by user in addition to IP

---

## OWASP Top 10 Coverage

| OWASP Category | Status | Notes |
|----------------|--------|-------|
| A01: Broken Access Control | **Good** | Consistent requireUser/requireAdmin/requireClientAccess on all routes |
| A02: Cryptographic Failures | **Good** | AES-256-GCM for tokens, HMAC-SHA256 for state, proper key management |
| A03: Injection | **Good** | Drizzle ORM prevents SQL injection; no raw SQL found |
| A04: Insecure Design | **Needs Work** | No global middleware, no defense-in-depth layer |
| A05: Security Misconfiguration | **Needs Work** | Empty next.config.ts, no security headers, no .env.example |
| A06: Vulnerable Components | **OK** | Auth.js v5 is current; dependencies should be audited regularly |
| A07: Auth Failures | **Good** | Rate limiting, invite-only, database sessions, 30-day expiry |
| A08: Data Integrity Failures | **Good** | HMAC-signed state tokens, authenticated encryption |
| A09: Logging & Monitoring | **Needs Work** | Console.error only, no structured logging or audit trail |
| A10: SSRF | **Low Risk** | No user-controlled URL fetching detected |
