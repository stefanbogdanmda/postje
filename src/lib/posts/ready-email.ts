import { Resend } from "resend"

const AUTH_RESEND_KEY = process.env.AUTH_RESEND_KEY
const EMAIL_FROM = process.env.EMAIL_FROM ?? "onboarding@resend.dev"

interface ComposedEmail {
  subject: string
  html: string
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * "Your posts are ready" email — the trigger that brings the client back for
 * their weekly ~5-minute review. Warm, friendly, no corporate Dutch.
 */
export function composePostsReadyEmail(
  businessName: string,
  pendingCount: number,
  appUrl: string
): ComposedEmail {
  const safeName = escapeHtml(businessName)
  const dashboardUrl = `${appUrl}/dashboard`
  const postWord = pendingCount === 1 ? "post" : "posts"

  const subject = `Je ${postWord} staan klaar — even checken?`

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      <h2 style="margin: 0 0 16px;">Postje</h2>
      <p style="margin: 0 0 12px;">Hoi!</p>
      <p style="margin: 0 0 12px;">
        We hebben ${pendingCount} nieuwe ${postWord} klaargezet voor
        <strong>${safeName}</strong>. Neem even een kijkje en keur ze goed —
        kost je zo'n vijf minuten.
      </p>
      <p style="margin: 0 0 24px;">
        <a href="${dashboardUrl}" style="display: inline-block; padding: 12px 20px; background: #1a1a1a; color: #fff; text-decoration: none; border-radius: 6px;">
          Bekijk je posts
        </a>
      </p>
      <p style="color: #666; font-size: 13px; margin: 0;">
        Liever niet posten deze week? Je kunt posts ook afkeuren — dan maken we nieuwe.
      </p>
    </div>
  `

  return { subject, html }
}

/**
 * Sends the "posts ready" email to the client. Best-effort: returns
 * success/failure so the caller can show it inline, but it never throws.
 */
export async function sendPostsReadyEmail(
  toEmail: string,
  businessName: string,
  pendingCount: number,
  appUrl: string
): Promise<{ success: boolean; error?: string }> {
  if (!AUTH_RESEND_KEY) {
    return { success: false, error: "AUTH_RESEND_KEY not configured" }
  }

  const { subject, html } = composePostsReadyEmail(businessName, pendingCount, appUrl)
  const resend = new Resend(AUTH_RESEND_KEY)

  try {
    await resend.emails.send({ from: EMAIL_FROM, to: toEmail, subject, html })
    return { success: true }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to send posts-ready email"
    return { success: false, error: message }
  }
}
