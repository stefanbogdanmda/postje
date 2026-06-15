"use server"

import { auth, signIn } from "@/lib/auth"
import { db } from "@/db"
import { users, clients } from "@/db/schema"
import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"
import { sendWelcomeEmail } from "@/lib/welcome-email"
import { parseLines, parseExamplePosts } from "./parse-voice-fields"
import { clampPostsPerWeek, DEFAULT_POSTS_PER_WEEK } from "@/lib/posts/config"
import { extractBrandVoice, MIN_TRANSCRIPT_LENGTH } from "@/lib/ai/extract-brand-voice"
import type { BrandVoiceDraft } from "@/lib/ai/types"

function readPostsPerWeek(formData: FormData): number {
  const raw = formData.get("postsPerWeek")
  return clampPostsPerWeek(raw ? Number(raw) : DEFAULT_POSTS_PER_WEEK)
}

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
  const toneOfVoice = (formData.get("toneOfVoice") as string) || null
  const targetCustomers = (formData.get("targetCustomers") as string) || null
  const brandPersonality = (formData.get("brandPersonality") as string) || null
  const bannedPhrases = parseLines(
    formData.get("bannedPhrases") as string | null
  )
  const examplePosts = parseExamplePosts(
    formData.get("examplePosts") as string | null
  )
  const postsPerWeek = readPostsPerWeek(formData)

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
      toneOfVoice: toneOfVoice?.trim() || null,
      targetCustomers: targetCustomers?.trim() || null,
      brandPersonality: brandPersonality?.trim() || null,
      bannedPhrases,
      examplePosts,
      postsPerWeek,
      // Start the 2-week calibration window now. The operator can push this
      // date later to extend calibration for a client that needs more spot-checks.
      calibrationStartDate: new Date(),
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
  const toneOfVoice = (formData.get("toneOfVoice") as string) || null
  const targetCustomers = (formData.get("targetCustomers") as string) || null
  const brandPersonality = (formData.get("brandPersonality") as string) || null
  const bannedPhrases = parseLines(
    formData.get("bannedPhrases") as string | null
  )
  const examplePosts = parseExamplePosts(
    formData.get("examplePosts") as string | null
  )
  const postsPerWeek = readPostsPerWeek(formData)

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
        toneOfVoice: toneOfVoice?.trim() || null,
        targetCustomers: targetCustomers?.trim() || null,
        brandPersonality: brandPersonality?.trim() || null,
        bannedPhrases,
        examplePosts,
        postsPerWeek,
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

/**
 * Onboarding helper: draft a brand-voice profile from a pasted kickoff-call
 * transcript. Admin-only, clientId-scoped, and READ-ONLY to the database — it
 * returns a draft for the operator to review/edit/apply; the existing
 * updateClient action remains the only thing that writes the profile. The
 * transcript is used transiently and never stored.
 */
export async function extractBrandVoiceForClient(
  clientId: string,
  transcript: string
): Promise<{ draft?: BrandVoiceDraft; error?: string }> {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return { error: "Unauthorized" }
  }

  if (!transcript || transcript.trim().length < MIN_TRANSCRIPT_LENGTH) {
    return { error: "Dit transcript lijkt te kort om iets uit te halen." }
  }

  const rows = await db
    .select({ businessName: clients.businessName })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)
  const client = rows[0]
  if (!client) {
    return { error: "Client not found." }
  }

  try {
    const draft = await extractBrandVoice(transcript.trim(), client.businessName)
    return { draft }
  } catch (err) {
    console.error("[extractBrandVoiceForClient] extraction failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    })
    return { error: "Kon de merkstem niet uithalen. Probeer het opnieuw." }
  }
}
