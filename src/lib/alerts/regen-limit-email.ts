import { Resend } from "resend"
import type { RegenLimitPost } from "@/lib/posts/repository"

const AUTH_RESEND_KEY = process.env.AUTH_RESEND_KEY
const EMAIL_FROM = process.env.EMAIL_FROM ?? "onboarding@resend.dev"
const ADMIN_EMAIL = process.env.ADMIN_EMAIL

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

function platformLabel(platform: "instagram" | "facebook"): string {
  return platform === "instagram" ? "Instagram" : "Facebook"
}

export function composeRegenLimitEmail(
  post: RegenLimitPost,
  appUrl: string
): ComposedEmail {
  const safeContent = escapeHtml(post.content)
  const safeBusinessName = escapeHtml(post.businessName)
  const safeScheduledDate = escapeHtml(post.scheduledDate)
  const platform = platformLabel(post.platform)
  const adminUrl = `${appUrl}/admin/clients/${post.clientId}`

  const subject = `Klant heeft een post ${post.rejectionCount}× laten herschrijven — ${safeBusinessName}`

  const html = `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      <h2 style="margin: 0 0 16px;">Post is ${post.rejectionCount}× herschreven</h2>
      <p style="margin: 0 0 8px;"><strong>Klant:</strong> ${safeBusinessName}</p>
      <p style="margin: 0 0 8px;"><strong>Platform:</strong> ${platform}</p>
      <p style="margin: 0 0 16px;"><strong>Geplande datum:</strong> ${safeScheduledDate}</p>
      <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
        <p style="margin: 0; white-space: pre-wrap;">${safeContent}</p>
      </div>
      <p style="margin: 0 0 16px;">
        Deze klant heeft een post ${post.rejectionCount} keer laten herschrijven en is mogelijk
        niet tevreden met de huidige toon. Overweeg het klantprofiel bij te stellen.
      </p>
      <p style="margin: 0 0 24px;">
        <a href="${adminUrl}" style="display: inline-block; padding: 10px 16px; background: #1a1a1a; color: #fff; text-decoration: none; border-radius: 6px;">
          Bekijk klantpagina
        </a>
      </p>
      <p style="color: #666; font-size: 13px; margin: 0;">
        Deze melding is automatisch verstuurd door Social AI. Eén keer per post — er volgt geen herhaling.
      </p>
    </div>
  `

  return { subject, html }
}

/**
 * Sends the regen-limit alert email via Resend. Returns success/failure so the
 * caller can decide whether to mark the post as alerted.
 */
export async function sendRegenLimitEmail(
  post: RegenLimitPost,
  appUrl: string
): Promise<{ success: boolean; error?: string }> {
  if (!AUTH_RESEND_KEY) {
    return { success: false, error: "AUTH_RESEND_KEY not configured" }
  }
  if (!ADMIN_EMAIL) {
    return { success: false, error: "ADMIN_EMAIL not configured" }
  }

  const { subject, html } = composeRegenLimitEmail(post, appUrl)
  const resend = new Resend(AUTH_RESEND_KEY)

  try {
    await resend.emails.send({
      from: EMAIL_FROM,
      to: ADMIN_EMAIL,
      subject,
      html,
    })
    return { success: true }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to send alert email"
    return { success: false, error: message }
  }
}
