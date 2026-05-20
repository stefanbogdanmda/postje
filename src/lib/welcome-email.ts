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
      subject: "Welkom bij Postje",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1a1a1a;">Postje</h2>
          <p>Hallo!</p>
          <p>
            Stefan heeft een account voor je aangemaakt bij Postje.
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
