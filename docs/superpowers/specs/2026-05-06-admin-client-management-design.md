# Admin Client Management — Design Spec

**Date:** 2026-05-06
**Status:** Approved
**Scope:** Admin-side client management (create, edit, list). No client-facing onboarding.

---

## Overview

Stefan manages client profiles through an admin interface. He creates new clients on their behalf (using info from kickoff calls), edits their business details, and sees all clients in a list. When a client is created, the system automatically sends a welcome email with a magic link so the client can log in.

This feature does NOT include: logo file upload (just a URL field), self-serve client signup, tone/brand/personality fields (those come from the kickoff call transcript pipeline — separate future feature), or payment integration.

---

## Data Model

### New table: `clients`

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `id` | UUID | Yes | Primary key |
| `userId` | UUID | Yes | Foreign key → `users.id`, unique constraint, cascade delete |
| `businessName` | Text | Yes | Core identifier for the client |
| `location` | Text | No | City or area (e.g., "Amsterdam") |
| `industry` | Text | No | Business sector (e.g., "Hospitality", "Retail") |
| `businessType` | Text | No | Business structure (e.g., "Restaurant", "Freelancer") |
| `productsServices` | Text | No | Longer text describing what the business offers |
| `logoUrl` | Text | No | URL pointing to the client's logo |
| `createdAt` | Timestamp | Yes | Auto-set on insert |
| `updatedAt` | Timestamp | Yes | Auto-set on insert, updated on edit |

**Relationship:** One-to-one with `users` where `role = "client"`. The `userId` column has a unique constraint — one client record per user, one user per client record. Cascade delete means deleting the user also removes the client record.

**Why a separate table?** The `users` table handles authentication and identity (email, role, session info). The `clients` table handles business information. Clean separation of concerns — auth data stays in `users`, domain data stays in `clients`.

---

## Pages & Routes

### `/admin/clients` — Client List

- **Auth:** Admin only (server-side role check, redirect to `/login` if not admin)
- **Layout:** Card list. Each client is a card row showing:
  - Business name (prominent, bold)
  - Secondary line: email · industry · location
  - Status badge: "Active" (green, `hasLoggedIn = true`) or "Invited" (amber, `hasLoggedIn = false`)
  - "Edit" link → `/admin/clients/[id]`
- **Header:** "Clients" title with "+ New Client" button → `/admin/clients/new`
- **Empty state:** Message like "No clients yet" with a link to create the first one
- **Navigation:** "← Back to admin" link to `/admin`

### `/admin/clients/new` — Create Client

- **Auth:** Admin only
- **Layout:** Single-column form, max-width ~500px
- **Fields:**
  - Email * (text input)
  - Business Name * (text input)
  - Location (text input) and Industry (text input) — side by side in a 2-column grid
  - Business Type (text input)
  - Products / Services (textarea)
  - Logo URL (text input)
- **Submit button:** "Create Client & Send Invite"
- **Helper text below button:** "Creates the account and sends a welcome email with a magic link."
- **Navigation:** "← Back to clients" link to `/admin/clients`
- **Validation:** Email must be valid format, business name must not be empty. Other fields optional.

### `/admin/clients/[id]` — Edit Client

- **Auth:** Admin only
- **Layout:** Same form layout as create
- **Differences from create:**
  - Header shows the business name + status badge instead of "New Client"
  - Email field is visible but disabled (greyed out) — cannot be changed after account creation
  - Helper text under email: "Email cannot be changed after account creation."
  - Fields are pre-filled with current values
  - Submit button: "Save Changes"
- **Not found:** If the client ID doesn't exist, show a 404 page
- **Navigation:** "← Back to clients" link to `/admin/clients`

---

## Navigation Between Admin Pages

No shared nav component. Simple links:

- `/admin` gets a "Manage clients →" link pointing to `/admin/clients`
- `/admin/clients` gets a "← Back to admin" link pointing to `/admin`
- `/admin/clients/new` and `/admin/clients/[id]` both have "← Back to clients" linking to `/admin/clients`

A proper admin nav will be built later when there are enough sections to justify it.

---

## Create Client Flow

When Stefan submits the create form, a single server action handles everything:

1. **Validate** — email is a valid format, business name is not empty
2. **Check for duplicate** — query `users` table by email. If a user already exists, return form error: "A user with this email already exists."
3. **Create user** — insert into `users` with `role: "client"`, `hasLoggedIn: false`
4. **Create client** — insert into `clients` with the `userId` from step 3 and all business fields
5. **Send welcome email** — different template from the standard login email (see Welcome Email section)
6. **Redirect** — to `/admin/clients`. An inline banner at the top of `/admin/clients` shows the success message, dismissible or auto-fading after a few seconds.

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Duplicate email | Show form error: "A user with this email already exists." Nothing created. |
| Email send fails | User and client records are still created. Show warning: "Client created, but the welcome email couldn't be sent." |
| Database error on client insert (after user created) | Delete the user created in step 3. Show generic error: "Something went wrong. Please try again." |
| Database error on user insert | Show generic error. Nothing created. |

**Key decision:** If the welcome email fails, the account is still created. The account and profile are the important part — Stefan can always trigger a new magic link manually. Blocking account creation on email delivery would be fragile.

---

## Edit Client Flow

1. **Load** — fetch client by `id` from URL param, join with `users` to get email and `hasLoggedIn` status. If not found, show 404.
2. **Display** — pre-fill form with current values. Email shown but disabled.
3. **Validate** — business name must not be empty
4. **Save** — update the `clients` row. Set `updatedAt` to now.
5. **Redirect** — to `/admin/clients`. An inline banner at the top of `/admin/clients` shows the success message, dismissible or auto-fading after a few seconds.

No changes to the `users` table on edit. No email sent on edit.

---

## Emails on Client Creation

Two emails are sent in sequence when a client is created:

### 1. Welcome Email (direct via Resend)

- **Subject:** "Welkom bij Postje"
- **Body (Dutch):** Friendly intro explaining Stefan created their account and that a login link is on the way. Example: "Stefan heeft een account voor je aangemaakt bij Postje. Je ontvangt zo een tweede e-mail met een inloglink waarmee je je dashboard kunt bekijken."
- **Tone:** Warm, friendly, conversational — matches the Postje brand voice
- **No magic link** — this email just provides context

### 2. Magic Link Email (via Auth.js)

- Standard Auth.js login email, triggered by `signIn("resend", ...)`
- Uses the existing login template: "Je inloglink voor Postje"
- Contains the actual magic link for logging in
- Works identically to the normal login flow — creates a session, sets `hasLoggedIn` to true on first click, lands the client on `/welcome` → `/dashboard`

**Why two emails?** Embedding a magic link in a custom email would require duplicating Auth.js's token generation, hashing, and URL construction — fragile coupling to internals. Two emails keeps each concern clean: welcome copy is ours, auth mechanism is Auth.js's.

**Rate limiter note:** The magic link email goes through Auth.js's `signIn`, which is subject to the rate limiter (5 requests per email per 15 min). If rate-limited, the magic link silently fails and Stefan sees a warning. Acceptable for v1 since Stefan is the only person triggering this.

---

## Visual Style

Matches the existing `/admin` and `/login` page aesthetic:

- **Colors:** #1a1a1a (buttons, primary), #666 (secondary text), #ddd (borders), #16a34a (active/green), #ca8a04 (invited/amber)
- **Typography:** System font stack (Arial/Helvetica), 15px form inputs, 13px labels and secondary text, 20px page headings
- **Inputs:** 1px solid #ddd border, 6px border-radius, 10px 12px padding
- **Buttons:** #1a1a1a background, white text, 6px border-radius, full-width on forms
- **Cards:** 1px solid #ddd border, 8px border-radius, 16px padding
- **Layout:** Max-width 800px for list, ~500px for forms. Inline styles (consistent with existing pages).
- **Disabled inputs:** #f9f9f9 background, #eee border, #999 text color

---

## Out of Scope (Explicit)

These are consciously deferred to future features:

- **Logo file upload** — just a URL text field for now. Upload comes with Vercel Pro post-first-paying-client.
- **Self-serve client signup** — clients don't create their own accounts yet. Stefan does it for them.
- **Tone of voice, brand personality, target customers, things to avoid** — these come from the kickoff call transcript pipeline (separate feature).
- **Payment integration** — no billing in the admin interface yet.
- **Client deletion from this interface** — already handled by the existing delete-user flow on `/admin`. Cascade delete removes the client record automatically.
- **Resend welcome email button** — could be useful but not in scope for v1. Stefan can use the normal login flow to send a new magic link.
- **Search/filter on client list** — not needed until there are enough clients to justify it.
