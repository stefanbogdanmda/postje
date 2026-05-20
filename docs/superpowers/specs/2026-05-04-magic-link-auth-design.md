# Magic Link Authentication — Design Spec

Written: 4 May 2026
Status: Approved
Feature: First feature for Postje

## Overview

Magic link authentication for Postje. Clients and the admin (Stefan) log in by entering their email and clicking a link sent to their inbox. No passwords. Built on Auth.js with Resend for email delivery and Drizzle for database storage.

## Decisions

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Auth library | Auth.js | Handles token hashing, session cookies, and security details. Drizzle adapter fits our database. Free. |
| Login flow | Same for all users | One flow, admin distinguished by `role` column |
| Session duration | 30 days | Spec requirement, same for clients and admin |
| Magic link expiry | 1 hour | Generous window for non-technical clients |
| Token invalidation | Latest token only | Auth.js invalidates previous tokens when a new one is generated |
| Unknown email behavior | Same "check your email" message | No information leaked about which emails have accounts |
| Account creation | Admin-only | Stefan creates all accounts, no public signup form |
| Rate limiting | 5 requests per email per 15 minutes | In-memory counter, balances abuse prevention with legitimate retries |
| First-login detection | `hasLoggedIn` boolean column | Auth.js sets `emailVerified` before our callback runs, so we use a separate flag |
| First-login flag timing | Flipped during redirect callback | Before welcome page loads, not on user action. Welcome page is a greeting, not a gate. |
| Role in session | Stored in session cookie | Avoids extra DB query per page load. Role changes take effect on next login. |
| Account deletion | Hard delete with audit log | Two-step confirmation, admin-only |
| Client-facing language | Dutch | Email, login page, welcome page, error messages |
| Admin dashboard language | English | Stefan's preference |
| Bootstrap | Seed script | `npm run seed-admin` reads email from env var |

## Login Flow (End to End)

1. User visits `/login` — sees a form with one email field
2. User submits email — the server checks if the email exists in the database
3. Whether it exists or not, the page shows: "Controleer je e-mail voor een inloglink" (Check your email for a login link)
4. If the email exists and rate limit not exceeded: system generates a one-time token, stores the hashed version in the database, sends an email via Resend with a magic link
5. User clicks the link (valid for 1 hour) — Auth.js verifies the token against the hashed version, destroys the token, creates a session
6. Session cookie set in the browser (30 days)
7. Redirect logic runs (see Redirect Logic section)

### Why tokens are hashed

The database stores a one-way hashed version of the token, not the token itself. If someone gains unauthorized database access, they cannot reverse the hash to reconstruct working login links. Auth.js handles this hashing automatically.

## Redirect Logic After Login

Evaluated in order during the Auth.js sign-in callback:

1. User role is `admin` → redirect to `/admin`
2. `hasLoggedIn` is `false` → set `hasLoggedIn` to `true`, redirect to `/welcome`
3. Otherwise → redirect to `/dashboard`

The `hasLoggedIn` flag flips during the redirect callback (before the welcome page loads), not on any user action on the welcome page.

## Database Schema

### `users`

| Column | Type | Notes |
|--------|------|-------|
| `id` | string (UUID or CUID) | Primary key |
| `email` | string | Unique, required |
| `name` | string | Optional |
| `role` | string | `"client"` or `"admin"`, set at account creation |
| `emailVerified` | timestamp | Managed by Auth.js, null until first login |
| `hasLoggedIn` | boolean | Default `false`, flipped to `true` on first login |
| `createdAt` | timestamp | When the account was created |

### `sessions`

| Column | Type | Notes |
|--------|------|-------|
| `sessionToken` | string | Primary key, value stored in browser cookie |
| `userId` | string | Foreign key to `users.id` |
| `expires` | timestamp | 30 days from session creation |

### `verification_tokens`

| Column | Type | Notes |
|--------|------|-------|
| `identifier` | string | The email address the link was sent to |
| `token` | string | Hashed token (not the original) |
| `expires` | timestamp | 1 hour from creation |

Composite primary key on (`identifier`, `token`).

### `accounts`

Auth.js requirement. Links users to their authentication provider (email/magic link for all users in our case). Schema is defined by the `@auth/drizzle-adapter` package — we use their exact column definitions without modification. Key columns include `userId` (foreign key to `users.id`), `type`, `provider`, and `providerAccountId`.

### `deletion_audit_log`

| Column | Type | Notes |
|--------|------|-------|
| `id` | string (UUID or CUID) | Primary key |
| `deletedUserEmail` | string | Email of the deleted account (preserved after user row is gone) |
| `deletedUserId` | string | Original user ID (for cross-referencing orphaned records) |
| `deletedBy` | string | User ID of whoever performed the deletion |
| `deletedAt` | timestamp | When the deletion occurred |

## Rate Limiting

- **Limit:** 5 magic link requests per email address per 15-minute window
- **Storage:** In-memory `Map` on the server (not in database)
- **Behavior when exceeded:** Same "check your email" message shown, but no email sent
- **Scope:** Per-email, not per-IP
- **Trade-off:** Counters reset on server restart. Acceptable — restarts are rare, worst case is a few extra emails.
- **Future consideration:** Add IP-based limiting if abuse becomes a real problem. YAGNI for now.

## Route Protection (Middleware)

Middleware runs before every page load and enforces access rules:

| Request | Behavior |
|---------|----------|
| `/login` — already logged in | Redirect to `/dashboard` (or `/admin` if admin) |
| `/login` — not logged in | Allow through |
| `/api/auth/*` | Always allow (Auth.js endpoints) |
| `/admin/*` — no session | Redirect to `/login` |
| `/admin/*` — session exists, role is `client` | Redirect to `/dashboard` |
| `/admin/*` — session exists, role is `admin` | Allow through |
| `/dashboard`, `/welcome` — no session | Redirect to `/login` |
| `/dashboard`, `/welcome` — valid session | Allow through |
| `/` — logged in as admin | Redirect to `/admin` |
| `/` — logged in as client | Redirect to `/dashboard` |
| `/` — not logged in | Redirect to `/login` |

### Deleted user with active session

If Stefan deletes a client who is currently logged in, their session cookie still exists in their browser. On next page visit, middleware looks up the session, finds no matching user, and redirects to `/login` gracefully. No error shown.

## Email Template

- **From (dev):** Resend default sender
- **From (production):** `Postje <login@postje.nl>` (domain not purchased yet — bought before first paying client)
- **Subject:** "Je inloglink voor Postje"
- **Language:** Dutch
- **Body contents:**
  - Short greeting
  - The magic link as a clear button
  - Note: "Deze link werkt 1 uur. Als je dit niet hebt aangevraagd, kun je deze e-mail veilig negeren."
  - No images, no marketing content, no footer clutter
- **Brand name in all communications:** "Postje"

## Bootstrap (Admin Seed Script)

**Command:** `npm run seed-admin`

**Behavior:**
1. Reads `ADMIN_EMAIL` from environment variables
2. Checks if a user with that email already exists — if yes, prints message and exits (safe to run multiple times)
3. Creates a user row: email from env, role `"admin"`, `hasLoggedIn` false, `emailVerified` null
4. Prints: "Admin account created for [email]"

**Prerequisites:**
1. `.env.local` file exists with `ADMIN_EMAIL` set
2. Database migrations have been run (tables exist)

**Setup order:**
1. `npm install`
2. Run database migrations
3. Create `.env.local` with `ADMIN_EMAIL=stefan@...`
4. `npm run seed-admin`
5. `npm run dev`

**Limitation:** The seed script creates the admin account but cannot update it. Changing the admin email later is a separate concern (not in scope for this feature).

## Account Deletion

- **Who can delete:** Admin only (Stefan)
- **Confirmation:** Two-step — click "Delete", then type the client's email to confirm. Delete executes only if typed email matches exactly.
- **What gets deleted:** Rows in `users`, `sessions`, `accounts`, and `verification_tokens` for the target user (hard delete)
- **Audit:** A row is inserted into `deletion_audit_log` with the deleted user's email, ID, who deleted them, and when
- **No cascade for content tables:** Content tables don't exist yet. Each future feature that adds client data is responsible for handling its own cleanup when a user is deleted.

## Pages and Routes

| Route | Purpose | Language | Scope in this feature |
|-------|---------|----------|-----------------------|
| `/login` | Email form for magic link | Dutch | Full implementation |
| `/welcome` | First-time client greeting | Dutch | Stub with heading and sign-out |
| `/dashboard` | Client's main area | Dutch | Stub with heading and sign-out |
| `/admin` | Stefan's management dashboard | English | Stub with user list and delete |
| `/` | Smart redirect | N/A | Redirect only, no page |

### Stub page details

- **`/welcome`:** Heading, short welcome message, "Ga verder" (Continue) link to `/dashboard`, sign-out link
- **`/dashboard`:** Heading ("Dashboard"), placeholder text, sign-out link ("Log uit")
- **`/admin`:** Heading ("Admin"), list of all users (email and role), delete button per client user, sign-out link ("Sign out")

## Explicitly Not Building

| Feature | Reason |
|---------|--------|
| Password login | Magic links only — simpler, no password storage risk |
| OAuth / social login ("Log in with Google") | Not needed, adds complexity |
| 2FA / two-factor authentication | Magic link already serves as a possession factor (you must have access to the email inbox). Adding a second factor is unnecessary complexity for the threat model. |
| Multi-device session management | Concurrent sessions on multiple devices are fine |
| Account deletion by clients | Admin-only for now |
| Email change flow | Stefan updates manually via admin dashboard (built later). Note: email changes have hidden complexity — the old email still works for magic links until the session expires, Auth.js ties identity to email, and any in-flight magic links to the old email would need to be invalidated. This is a future feature that needs its own design. |
| "Remember me" checkbox | Sessions are always 30 days |
| Public signup form | Stefan creates all accounts |
| Password reset | No passwords exist |
| Landing / marketing page | No public visitors during build phase |

## Dependencies

| Dependency | Purpose |
|------------|---------|
| `next-auth` (Auth.js v5) | Authentication framework |
| `@auth/drizzle-adapter` | Connects Auth.js to our Drizzle/SQLite database |
| `resend` | Email delivery for magic links |
| `drizzle-orm` | Database ORM (TypeScript interface to SQLite) |
| `drizzle-kit` | Database migration tooling |
| `better-sqlite3` | SQLite driver for Node.js |

## Environment Variables

| Variable | Purpose | Where |
|----------|---------|-------|
| `AUTH_SECRET` | Signs session cookies (Auth.js requirement) | `.env.local` |
| `AUTH_RESEND_KEY` | API key for sending emails via Resend | `.env.local` |
| `ADMIN_EMAIL` | Stefan's email, used by seed script | `.env.local` |

All listed in `.env.example` with placeholder values. Never committed with real values.
