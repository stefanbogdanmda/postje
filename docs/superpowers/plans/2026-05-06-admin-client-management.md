# Admin Client Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin interface where Stefan creates, edits, and lists client profiles, with automatic welcome email on creation.

**Architecture:** New `clients` table (Drizzle/SQLite) linked one-to-one with `users`. Three new pages under `/admin/clients/` using Next.js server components with server actions for mutations. On client creation, two emails are sent: a welcome email (direct via Resend) followed by a standard Auth.js magic link email. This avoids coupling welcome copy to Auth.js internals.

**Tech Stack:** Next.js 16, Drizzle ORM, SQLite, Auth.js, Resend, inline styles.

**Spec:** `docs/superpowers/specs/2026-05-06-admin-client-management-design.md`

---

## File Structure

| File | Purpose |
|------|---------|
| `src/db/schema.ts` | **Modify** — add `clients` table definition |
| `src/db/migrations/0001_*.sql` | **Generated** — migration for clients table |
| `src/app/admin/clients/page.tsx` | **Create** — client list page (card layout) |
| `src/app/admin/clients/new/page.tsx` | **Create** — create client form page |
| `src/app/admin/clients/[id]/page.tsx` | **Create** — edit client page (server component, fetches data directly) |
| `src/app/admin/clients/[id]/edit-client-form.tsx` | **Create** — edit form client component (receives data as props) |
| `src/app/admin/clients/actions.ts` | **Create** — server actions (createClient, updateClient) |
| `src/components/success-banner.tsx` | **Create** — dismissible/auto-fading inline success banner |
| `src/lib/welcome-email.ts` | **Create** — sends welcome email directly via Resend |
| `src/app/admin/page.tsx` | **Modify** — add "Manage clients →" link |

---

## Task 1: Add `clients` Table to Schema

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add the clients table definition to schema.ts**

Add this after the `users` table definition in `src/db/schema.ts`:

```typescript
// ──────────────────────────────────────────────
// clients — business profiles for client users
// ──────────────────────────────────────────────
export const clients = sqliteTable("clients", {
  id: text("id")
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  businessName: text("businessName").notNull(),
  location: text("location"),
  industry: text("industry"),
  businessType: text("businessType"),
  productsServices: text("productsServices"),
  logoUrl: text("logoUrl"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
})
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`

Expected: Drizzle creates a new migration file in `src/db/migrations/` (something like `0001_*.sql`) with a `CREATE TABLE clients` statement.

- [ ] **Step 3: Run the migration**

Run: `npm run db:migrate`

Expected: Migration applies cleanly. The `clients` table now exists in `sqlite.db`.

- [ ] **Step 4: Verify the build still works**

Run: `npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -m "feat: add clients table schema and migration"
```

---

## Task 2: Create Welcome Email Function

**Files:**
- Create: `src/lib/welcome-email.ts`

On client creation, two emails are sent in sequence:
1. **Welcome email** — sent directly via Resend from the server action. Warm Dutch copy explaining Stefan created the account.
2. **Magic link email** — triggered via `signIn("resend")`, uses the existing Auth.js template. Contains the actual login link.

This avoids coupling welcome copy to Auth.js internals and eliminates the concurrency risk of a module-level flag. The client receives two emails, but they serve distinct purposes — "welcome" then "here's your login link" — which is actually clearer than combining both into one.

- [ ] **Step 1: Create the welcome email module**

Create `src/lib/welcome-email.ts`:

```typescript
import { Resend } from "resend"

const AUTH_RESEND_KEY = process.env.AUTH_RESEND_KEY
const EMAIL_FROM = process.env.EMAIL_FROM ?? "onboarding@resend.dev"

/**
 * Sends a welcome email to a newly created client.
 * This is a separate email from the magic link — it provides context
 * ("Stefan created your account") before the Auth.js login email arrives.
 *
 * Returns { success: true } or { success: false, error: string }.
 *
 * Note: Email delivery order is not guaranteed — the magic link email
 * (sent after this via Auth.js) could arrive before the welcome email.
 * Acceptable for v1 since the magic link works on its own regardless.
 */
export async function sendWelcomeEmail(email: string): Promise<{
  success: boolean
  error?: string
}> {
  if (!AUTH_RESEND_KEY) {
    return { success: false, error: "AUTH_RESEND_KEY not configured" }
  }

  const resend = new Resend(AUTH_RESEND_KEY)

  try {
    await resend.emails.send({
      from: EMAIL_FROM,
      to: email,
      subject: "Welkom bij Social AI",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1a1a1a;">Social AI</h2>
          <p>Hallo!</p>
          <p>
            Stefan heeft een account voor je aangemaakt bij Social AI.
            Je ontvangt zo een tweede e-mail met een inloglink waarmee
            je je dashboard kunt bekijken.
          </p>
          <p style="color: #666; font-size: 14px;">
            Heb je vragen? Neem dan contact op met Stefan.
          </p>
        </div>
      `,
    })
    return { success: true }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to send welcome email"
    return { success: false, error: message }
  }
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/welcome-email.ts
git commit -m "feat: add welcome email function for new clients"
```

---

## Task 3: Create Success Banner Component

**Files:**
- Create: `src/components/success-banner.tsx`

- [ ] **Step 1: Create the success banner component**

Create `src/components/success-banner.tsx`:

```typescript
"use client"

import { useState, useEffect } from "react"

interface SuccessBannerProps {
  message: string
  /** Auto-fade after this many milliseconds. Defaults to 5000 (5 seconds). */
  fadeAfterMs?: number
}

export default function SuccessBanner({
  message,
  fadeAfterMs = 5000,
}: SuccessBannerProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), fadeAfterMs)
    return () => clearTimeout(timer)
  }, [fadeAfterMs])

  if (!visible) return null

  return (
    <div
      style={{
        padding: "12px 16px",
        backgroundColor: "#f0fdf4",
        border: "1px solid #bbf7d0",
        borderRadius: "6px",
        marginBottom: "24px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: "14px",
        color: "#166534",
      }}
    >
      <span>{message}</span>
      <button
        onClick={() => setVisible(false)}
        style={{
          background: "none",
          border: "none",
          color: "#166534",
          cursor: "pointer",
          fontSize: "18px",
          padding: "0 4px",
          lineHeight: 1,
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/success-banner.tsx
git commit -m "feat: add dismissible success banner component"
```

---

## Task 4: Create Server Actions for Client Management

**Files:**
- Create: `src/app/admin/clients/actions.ts`

- [ ] **Step 1: Create the server actions file**

Create `src/app/admin/clients/actions.ts`:

```typescript
"use server"

import { auth, signIn } from "@/lib/auth"
import { db } from "@/db"
import { users, clients } from "@/db/schema"
import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"
import { sendWelcomeEmail } from "@/lib/welcome-email"

interface ActionResult {
  error?: string
}

export async function createClient(formData: FormData): Promise<ActionResult> {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return { error: "Unauthorized" }
  }

  const email = formData.get("email") as string | null
  const businessName = formData.get("businessName") as string | null
  const location = (formData.get("location") as string) || null
  const industry = (formData.get("industry") as string) || null
  const businessType = (formData.get("businessType") as string) || null
  const productsServices =
    (formData.get("productsServices") as string) || null
  const logoUrl = (formData.get("logoUrl") as string) || null

  // Validate required fields
  if (!email || !email.includes("@")) {
    return { error: "A valid email address is required." }
  }
  if (!businessName || businessName.trim() === "") {
    return { error: "Business name is required." }
  }

  // Check for duplicate email
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .get()

  if (existingUser) {
    return { error: "A user with this email already exists." }
  }

  // Create the user
  let newUserId: string
  try {
    const result = await db
      .insert(users)
      .values({
        email: email.toLowerCase(),
        role: "client",
        hasLoggedIn: false,
      })
      .returning({ id: users.id })

    newUserId = result[0].id
  } catch {
    return { error: "Something went wrong. Please try again." }
  }

  // Create the client profile
  try {
    await db.insert(clients).values({
      userId: newUserId,
      businessName: businessName.trim(),
      location: location?.trim() || null,
      industry: industry?.trim() || null,
      businessType: businessType?.trim() || null,
      productsServices: productsServices?.trim() || null,
      logoUrl: logoUrl?.trim() || null,
    })
  } catch {
    // Roll back: delete the user we just created
    await db.delete(users).where(eq(users.id, newUserId))
    return { error: "Something went wrong. Please try again." }
  }

  // Two emails are sent in sequence:
  // 1. Welcome email (direct via Resend) — warm intro, no magic link
  // 2. Magic link email (via Auth.js signIn) — standard login template
  //
  // Note: The magic link email goes through signIn("resend"), which is
  // subject to the rate limiter (5 requests per email per 15 min).
  // If the email was somehow rate-limited, the magic link silently
  // fails and Stefan sees the "couldn't send" warning. Acceptable
  // for v1 since Stefan is the only person triggering this.
  let emailFailed = false
  try {
    await sendWelcomeEmail(email.toLowerCase())
    await signIn("resend", {
      email: email.toLowerCase(),
      redirect: false,
    })
  } catch {
    emailFailed = true
  }

  if (emailFailed) {
    redirect(
      "/admin/clients?success=" +
        encodeURIComponent(
          "Client created, but the welcome email couldn't be sent."
        )
    )
  }

  redirect(
    "/admin/clients?success=" +
      encodeURIComponent(`${businessName.trim()} has been added as a client.`)
  )
}

export async function updateClient(
  clientId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return { error: "Unauthorized" }
  }

  const businessName = formData.get("businessName") as string | null
  const location = (formData.get("location") as string) || null
  const industry = (formData.get("industry") as string) || null
  const businessType = (formData.get("businessType") as string) || null
  const productsServices =
    (formData.get("productsServices") as string) || null
  const logoUrl = (formData.get("logoUrl") as string) || null

  if (!businessName || businessName.trim() === "") {
    return { error: "Business name is required." }
  }

  // Verify the client exists
  const existingClient = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, clientId))
    .get()

  if (!existingClient) {
    return { error: "Client not found." }
  }

  try {
    await db
      .update(clients)
      .set({
        businessName: businessName.trim(),
        location: location?.trim() || null,
        industry: industry?.trim() || null,
        businessType: businessType?.trim() || null,
        productsServices: productsServices?.trim() || null,
        logoUrl: logoUrl?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, clientId))
  } catch {
    return { error: "Something went wrong. Please try again." }
  }

  redirect(
    "/admin/clients?success=" +
      encodeURIComponent(`${businessName.trim()} has been updated.`)
  )
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/clients/actions.ts
git commit -m "feat: add server actions for creating and editing clients"
```

---

## Task 5: Build the Client List Page

**Files:**
- Create: `src/app/admin/clients/page.tsx`

- [ ] **Step 1: Create the client list page**

Create `src/app/admin/clients/page.tsx`:

```typescript
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { clients, users } from "@/db/schema"
import { eq } from "drizzle-orm"
import Link from "next/link"
import SuccessBanner from "@/components/success-banner"

interface ClientListPageProps {
  searchParams: Promise<{ success?: string }>
}

export default async function ClientListPage({
  searchParams,
}: ClientListPageProps) {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    redirect("/login")
  }

  const params = await searchParams
  const successMessage = params.success

  // Join clients with users to get email and hasLoggedIn status
  const allClients = await db
    .select({
      id: clients.id,
      businessName: clients.businessName,
      location: clients.location,
      industry: clients.industry,
      email: users.email,
      hasLoggedIn: users.hasLoggedIn,
    })
    .from(clients)
    .innerJoin(users, eq(clients.userId, users.id))
    .all()

  return (
    <main style={{ padding: "32px", maxWidth: "800px" }}>
      <div style={{ marginBottom: "24px" }}>
        <Link
          href="/admin"
          style={{
            color: "#666",
            fontSize: "13px",
            textDecoration: "none",
          }}
        >
          ← Back to admin
        </Link>
      </div>

      {successMessage && <SuccessBanner message={successMessage} />}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
        }}
      >
        <h1 style={{ fontSize: "24px" }}>Clients</h1>
        <Link
          href="/admin/clients/new"
          style={{
            backgroundColor: "#1a1a1a",
            color: "#fff",
            padding: "8px 16px",
            borderRadius: "6px",
            fontSize: "14px",
            textDecoration: "none",
            fontWeight: 500,
          }}
        >
          + New Client
        </Link>
      </div>

      {allClients.length === 0 ? (
        <div style={{ color: "#666", textAlign: "center", padding: "48px 0" }}>
          <p style={{ marginBottom: "8px" }}>No clients yet.</p>
          <Link
            href="/admin/clients/new"
            style={{ color: "#1a1a1a", textDecoration: "underline" }}
          >
            Create your first client
          </Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {allClients.map((client) => (
            <div
              key={client.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: "8px",
                padding: "16px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: "15px" }}>
                  {client.businessName}
                </div>
                <div
                  style={{ color: "#666", fontSize: "13px", marginTop: "2px" }}
                >
                  {[client.email, client.industry, client.location]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div
                style={{ display: "flex", alignItems: "center", gap: "12px" }}
              >
                <span
                  style={{
                    color: client.hasLoggedIn ? "#16a34a" : "#ca8a04",
                    fontSize: "13px",
                  }}
                >
                  {client.hasLoggedIn ? "Active" : "Invited"}
                </span>
                <Link
                  href={`/admin/clients/${client.id}`}
                  style={{
                    color: "#1a1a1a",
                    textDecoration: "underline",
                    fontSize: "13px",
                  }}
                >
                  Edit
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`

Expected: Build succeeds. The page is accessible at `/admin/clients`.

- [ ] **Step 3: Manually test**

Run: `npm run dev`

Navigate to `http://localhost:3000/admin/clients` (while logged in as admin). You should see the empty state: "No clients yet." with a link to create the first one.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/clients/page.tsx
git commit -m "feat: add client list page with card layout"
```

---

## Task 6: Build the Create Client Page

**Files:**
- Create: `src/app/admin/clients/new/page.tsx`

- [ ] **Step 1: Create the new client page**

Create `src/app/admin/clients/new/page.tsx`:

```typescript
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "../actions"

export default function NewClientPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = await createClient(formData)

    // If we get here (no redirect), there was an error
    if (result?.error) {
      setError(result.error)
    }
    setLoading(false)
  }

  const labelStyle = {
    display: "block" as const,
    fontSize: "13px",
    fontWeight: 500,
    marginBottom: "6px",
    color: "#333",
  }

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #ddd",
    borderRadius: "6px",
    fontSize: "15px",
    boxSizing: "border-box" as const,
  }

  return (
    <main
      style={{
        padding: "32px",
        maxWidth: "500px",
      }}
    >
      <div style={{ marginBottom: "24px" }}>
        <Link
          href="/admin/clients"
          style={{
            color: "#666",
            fontSize: "13px",
            textDecoration: "none",
          }}
        >
          ← Back to clients
        </Link>
      </div>

      <h1 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "24px" }}>
        New Client
      </h1>

      {error && (
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "6px",
            marginBottom: "20px",
            fontSize: "14px",
            color: "#991b1b",
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="email" style={labelStyle}>
            Email *
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="client@example.nl"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="businessName" style={labelStyle}>
            Business Name *
          </label>
          <input
            id="businessName"
            name="businessName"
            type="text"
            required
            placeholder="Café De Hoek"
            style={inputStyle}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "16px",
            marginBottom: "20px",
          }}
        >
          <div>
            <label htmlFor="location" style={labelStyle}>
              Location
            </label>
            <input
              id="location"
              name="location"
              type="text"
              placeholder="Amsterdam"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="industry" style={labelStyle}>
              Industry
            </label>
            <input
              id="industry"
              name="industry"
              type="text"
              placeholder="Hospitality"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="businessType" style={labelStyle}>
            Business Type
          </label>
          <input
            id="businessType"
            name="businessType"
            type="text"
            placeholder="Restaurant"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="productsServices" style={labelStyle}>
            Products / Services
          </label>
          <textarea
            id="productsServices"
            name="productsServices"
            placeholder="Describe what this business offers..."
            style={{
              ...inputStyle,
              minHeight: "80px",
              resize: "vertical" as const,
              fontFamily: "inherit",
            }}
          />
        </div>

        <div style={{ marginBottom: "28px" }}>
          <label htmlFor="logoUrl" style={labelStyle}>
            Logo URL
          </label>
          <input
            id="logoUrl"
            name="logoUrl"
            type="url"
            placeholder="https://..."
            style={inputStyle}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "12px 24px",
            backgroundColor: "#1a1a1a",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            fontSize: "15px",
            fontWeight: 500,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Creating..." : "Create Client & Send Invite"}
        </button>
        <p
          style={{
            color: "#666",
            fontSize: "12px",
            marginTop: "8px",
            textAlign: "center",
          }}
        >
          Creates the account and sends a welcome email with a magic link.
        </p>
      </form>
    </main>
  )
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`

Expected: Build succeeds.

- [ ] **Step 3: Manually test the create flow**

Run: `npm run dev`

1. Navigate to `http://localhost:3000/admin/clients/new`
2. Fill in email and business name (use a test email you can check)
3. Submit the form
4. You should be redirected to `/admin/clients` with a success banner
5. The new client should appear in the card list

- [ ] **Step 4: Test error handling**

1. Try submitting the same email again — should see "A user with this email already exists."
2. Try submitting with an empty business name — should see validation error

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/clients/new/page.tsx
git commit -m "feat: add create client form page"
```

---

## Task 7: Build the Edit Client Page

**Files:**
- Create: `src/app/admin/clients/[id]/page.tsx` (server component — fetches data directly)
- Create: `src/app/admin/clients/[id]/edit-client-form.tsx` (client component — handles form state)

The edit page is a server component that fetches client data directly from the database, then passes it to a client component for the interactive form. No API route needed — the server component does the data loading, the client component handles submit/error state.

- [ ] **Step 1: Create the edit client form (client component)**

Create `src/app/admin/clients/[id]/edit-client-form.tsx`:

```typescript
"use client"

import { useState } from "react"
import { updateClient } from "../actions"

interface EditClientFormProps {
  clientId: string
  email: string
  businessName: string
  location: string | null
  industry: string | null
  businessType: string | null
  productsServices: string | null
  logoUrl: string | null
  hasLoggedIn: boolean
}

export default function EditClientForm({
  clientId,
  email,
  businessName,
  location,
  industry,
  businessType,
  productsServices,
  logoUrl,
  hasLoggedIn,
}: EditClientFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = await updateClient(clientId, formData)

    if (result?.error) {
      setError(result.error)
    }
    setLoading(false)
  }

  const labelStyle = {
    display: "block" as const,
    fontSize: "13px",
    fontWeight: 500,
    marginBottom: "6px",
    color: "#333",
  }

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #ddd",
    borderRadius: "6px",
    fontSize: "15px",
    boxSizing: "border-box" as const,
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
        }}
      >
        <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0 }}>
          {businessName}
        </h1>
        <span
          style={{
            color: hasLoggedIn ? "#16a34a" : "#ca8a04",
            fontSize: "13px",
          }}
        >
          {hasLoggedIn ? "Active" : "Invited"}
        </span>
      </div>

      {error && (
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "6px",
            marginBottom: "20px",
            fontSize: "14px",
            color: "#991b1b",
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="email" style={labelStyle}>
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            disabled
            style={{
              ...inputStyle,
              backgroundColor: "#f9f9f9",
              border: "1px solid #eee",
              color: "#999",
            }}
          />
          <p style={{ color: "#999", fontSize: "12px", marginTop: "4px" }}>
            Email cannot be changed after account creation.
          </p>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="businessName" style={labelStyle}>
            Business Name *
          </label>
          <input
            id="businessName"
            name="businessName"
            type="text"
            required
            defaultValue={businessName}
            style={inputStyle}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "16px",
            marginBottom: "20px",
          }}
        >
          <div>
            <label htmlFor="location" style={labelStyle}>
              Location
            </label>
            <input
              id="location"
              name="location"
              type="text"
              defaultValue={location ?? ""}
              placeholder="Amsterdam"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="industry" style={labelStyle}>
              Industry
            </label>
            <input
              id="industry"
              name="industry"
              type="text"
              defaultValue={industry ?? ""}
              placeholder="Hospitality"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="businessType" style={labelStyle}>
            Business Type
          </label>
          <input
            id="businessType"
            name="businessType"
            type="text"
            defaultValue={businessType ?? ""}
            placeholder="Restaurant"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="productsServices" style={labelStyle}>
            Products / Services
          </label>
          <textarea
            id="productsServices"
            name="productsServices"
            defaultValue={productsServices ?? ""}
            placeholder="Describe what this business offers..."
            style={{
              ...inputStyle,
              minHeight: "80px",
              resize: "vertical" as const,
              fontFamily: "inherit",
            }}
          />
        </div>

        <div style={{ marginBottom: "28px" }}>
          <label htmlFor="logoUrl" style={labelStyle}>
            Logo URL
          </label>
          <input
            id="logoUrl"
            name="logoUrl"
            type="url"
            defaultValue={logoUrl ?? ""}
            placeholder="https://..."
            style={inputStyle}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "12px 24px",
            backgroundColor: "#1a1a1a",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            fontSize: "15px",
            fontWeight: 500,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </>
  )
}
```

- [ ] **Step 2: Create the edit page (server component)**

Create `src/app/admin/clients/[id]/page.tsx`:

```typescript
import { auth } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import { db } from "@/db"
import { clients, users } from "@/db/schema"
import { eq } from "drizzle-orm"
import Link from "next/link"
import EditClientForm from "./edit-client-form"

interface EditClientPageProps {
  params: Promise<{ id: string }>
}

export default async function EditClientPage({
  params,
}: EditClientPageProps) {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    redirect("/login")
  }

  const { id } = await params

  const client = await db
    .select({
      id: clients.id,
      businessName: clients.businessName,
      location: clients.location,
      industry: clients.industry,
      businessType: clients.businessType,
      productsServices: clients.productsServices,
      logoUrl: clients.logoUrl,
      email: users.email,
      hasLoggedIn: users.hasLoggedIn,
    })
    .from(clients)
    .innerJoin(users, eq(clients.userId, users.id))
    .where(eq(clients.id, id))
    .get()

  if (!client) {
    notFound()
  }

  return (
    <main style={{ padding: "32px", maxWidth: "500px" }}>
      <div style={{ marginBottom: "24px" }}>
        <Link
          href="/admin/clients"
          style={{
            color: "#666",
            fontSize: "13px",
            textDecoration: "none",
          }}
        >
          ← Back to clients
        </Link>
      </div>

      <EditClientForm
        clientId={client.id}
        email={client.email}
        businessName={client.businessName}
        location={client.location}
        industry={client.industry}
        businessType={client.businessType}
        productsServices={client.productsServices}
        logoUrl={client.logoUrl}
        hasLoggedIn={client.hasLoggedIn}
      />
    </main>
  )
}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`

Expected: Build succeeds.

- [ ] **Step 4: Manually test the edit flow**

Run: `npm run dev`

1. Navigate to `/admin/clients` and click "Edit" on a client
2. Verify all fields are pre-filled
3. Verify the email field is disabled/greyed out
4. Change the business name and click "Save Changes"
5. Verify redirect to `/admin/clients` with success banner
6. Click "Edit" again — verify the change persisted

- [ ] **Step 5: Test the 404 case**

Navigate to `/admin/clients/nonexistent-id`. Should see Next.js's default not-found page.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/clients/[id]/page.tsx src/app/admin/clients/[id]/edit-client-form.tsx
git commit -m "feat: add edit client page with server-side data loading"
```

---

## Task 8: Add "Manage Clients" Link to Admin Page

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Add the link to the admin page**

In `src/app/admin/page.tsx`, add a `Link` import at the top and a "Manage clients →" link after the users table.

Add to imports:

```typescript
import Link from "next/link"
```

Add after the closing `</table>` tag (before `</main>`):

```tsx
      <div style={{ marginTop: "32px" }}>
        <Link
          href="/admin/clients"
          style={{
            color: "#1a1a1a",
            textDecoration: "underline",
            fontSize: "14px",
          }}
        >
          Manage clients →
        </Link>
      </div>
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`

Expected: Build succeeds.

- [ ] **Step 3: Manually test**

Navigate to `/admin`. The "Manage clients →" link should appear below the users table and navigate to `/admin/clients`.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "feat: add manage clients link to admin page"
```

---

## Task 9: End-to-End Manual Testing

No new files. This task verifies the complete flow works together.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Test the full create flow**

1. Log in as admin → navigate to `/admin`
2. Click "Manage clients →"
3. See empty state on `/admin/clients`
4. Click "+ New Client"
5. Fill in all fields with test data (use a real email you can check)
6. Click "Create Client & Send Invite"
7. Verify redirect to `/admin/clients` with success banner
8. Verify the new client appears in the card list with "Invited" status
9. Check inbox for welcome email

- [ ] **Step 3: Test the edit flow**

1. Click "Edit" on the client you just created
2. Verify email is disabled
3. Change the business name
4. Click "Save Changes"
5. Verify redirect with success banner
6. Click "Edit" again — verify the new name persisted

- [ ] **Step 4: Test error handling**

1. Go to `/admin/clients/new`
2. Try creating another client with the same email → should see duplicate error
3. Try submitting with empty business name → should see validation error

- [ ] **Step 5: Test navigation**

1. `/admin` → "Manage clients →" → `/admin/clients`
2. `/admin/clients` → "← Back to admin" → `/admin`
3. `/admin/clients` → "+ New Client" → `/admin/clients/new`
4. `/admin/clients/new` → "← Back to clients" → `/admin/clients`
5. `/admin/clients` → "Edit" → `/admin/clients/[id]`
6. `/admin/clients/[id]` → "← Back to clients" → `/admin/clients`

- [ ] **Step 6: Test the 404 case**

Navigate to `/admin/clients/nonexistent-id`. Should see Next.js's not-found page (the server component calls `notFound()` when the client doesn't exist).

- [ ] **Step 7: Verify production build**

Run: `npm run build`

Expected: Build succeeds with no errors or warnings.

- [ ] **Step 8: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end testing"
```

Only run this if you made changes during testing. Skip if everything worked on the first pass.
