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
  const existingUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1)

  if (existingUsers.length > 0) {
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
  const existingClients = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)

  if (existingClients.length === 0) {
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
