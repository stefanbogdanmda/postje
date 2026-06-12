import { Resend } from "resend"

const AUTH_RESEND_KEY = process.env.AUTH_RESEND_KEY
const EMAIL_FROM = process.env.EMAIL_FROM ?? "onboarding@resend.dev"
const ADMIN_EMAIL = process.env.ADMIN_EMAIL

export interface FlagAlert {
  clientId: string
  businessName: string
  platform: "instagram" | "facebook"
  scheduledDate: string
  content: string
  reason: string | null
}

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

export function composeFlagAlertEmail(
  flag: FlagAlert,
  appUrl: string
): ComposedEmail {
  const safeBusinessName = escapeHtml(flag.businessName)
  const safeContent = escapeHtml(flag.content)
  const platform = platformLabel(flag.platform)
  const adminUrl = `${appUrl}/admin/clients/${flag.clientId}`
  const reasonBlock = flag.reason
    ? `<p style="margin: 0 0 8px;"><strong>Reden:</strong> ${escapeHtml(flag.reason)}</p>`
    : ""

  const subject = `Actie nodig: ${flag.businessName} heeft een gepubliceerde post gemarkeerd`

  const html = `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      <h2 style="margin: 0 0 16px; color: #b91c1c;">Een klant heeft een post gemarkeerd</h2>
      <p style="margin: 0 0 8px;"><strong>Klant:</strong> ${safeBusinessName}</p>
      <p style="margin: 0 0 8px;"><strong>Platform:</strong> ${platform}</p>
      <p style="margin: 0 0 8px;"><strong>Geplande datum:</strong> ${flag.scheduledDate}</p>
      ${reasonBlock}
      <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 16px; border-radius: 8px; margin: 12px 0 16px;">
        <p style="margin: 0; white-space: pre-wrap;">${safeContent}</p>
      </div>
      <p style="margin: 0 0 24px;">
        <a href="${adminUrl}" style="display: inline-block; padding: 10px 16px; background: #1a1a1a; color: #fff; text-decoration: none; border-radius: 6px;">
          Bekijk klantpagina
        </a>
      </p>
      <p style="color: #666; font-size: 13px; margin: 0;">
        Deze melding is direct verstuurd toen de klant op de markeerknop drukte. Markeringen zijn het meest urgente signaal — bekijk deze zo snel mogelijk.
      </p>
    </div>
  `

  return { subject, html }
}

/**
 * Sends the flag alert to the operator immediately. Best-effort: returns
 * success/failure so the caller can log it, but flagging must never fail just
 * because the email could not be sent.
 */
export async function sendFlagAlert(
  flag: FlagAlert,
  appUrl: string
): Promise<{ success: boolean; error?: string }> {
  if (!AUTH_RESEND_KEY) {
    return { success: false, error: "AUTH_RESEND_KEY not configured" }
  }
  if (!ADMIN_EMAIL) {
    return { success: false, error: "ADMIN_EMAIL not configured" }
  }

  const { subject, html } = composeFlagAlertEmail(flag, appUrl)
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
      error instanceof Error ? error.message : "Failed to send flag alert email"
    return { success: false, error: message }
  }
}
