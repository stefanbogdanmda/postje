import { Resend } from "resend"

const AUTH_RESEND_KEY = process.env.AUTH_RESEND_KEY
const EMAIL_FROM = process.env.EMAIL_FROM ?? "onboarding@resend.dev"

export interface ComposedEmail {
  subject: string
  html: string
}

export interface DeletionEmailArgs {
  to: string
  scheduledFor: Date
  cancelToken: string
  appUrl: string
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function formatScheduledFor(when: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Amsterdam",
  }).format(when)
}

export function composeDeletionEmail(args: DeletionEmailArgs): ComposedEmail {
  const safeEmail = escapeHtml(args.to)
  const safeToken = encodeURIComponent(args.cancelToken)
  const formattedTime = escapeHtml(formatScheduledFor(args.scheduledFor))
  const cancelUrl = `${args.appUrl}/api/account/deletion/cancel?token=${safeToken}`

  const subject = "Bevestiging: je account wordt over 24 uur verwijderd"

  const html = `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      <h2 style="margin: 0 0 16px;">Je hebt om verwijdering gevraagd</h2>
      <p style="margin: 0 0 12px;">Hallo!</p>
      <p style="margin: 0 0 12px;">
        Je hebt zojuist gevraagd om je Social AI-account (${safeEmail}) te verwijderen.
        We wachten 24 uur voordat we dit definitief doen &mdash; zodat je tijd hebt om je te bedenken.
      </p>
      <p style="margin: 0 0 24px; padding: 12px 16px; background: #fff7e6; border-left: 4px solid #f5a623; border-radius: 4px;">
        <strong>Je account wordt verwijderd op ${formattedTime}.</strong>
      </p>
      <p style="margin: 0 0 24px;">
        Wil je dit toch niet? Klik op de knop hieronder, dan annuleren we het verzoek meteen.
      </p>
      <p style="margin: 0 0 24px;">
        <a href="${cancelUrl}" style="display: inline-block; padding: 10px 16px; background: #1a1a1a; color: #fff; text-decoration: none; border-radius: 6px;">
          Annuleer verwijdering
        </a>
      </p>
      <p style="color: #666; font-size: 13px; margin: 0;">
        Heb je vragen? Reageer op deze mail (zolang je nog kunt!).
      </p>
    </div>
  `

  return { subject, html }
}

/** Send the email via Resend. Returns success/failure for the caller. */
export async function sendDeletionEmail(
  args: DeletionEmailArgs
): Promise<{ success: true } | { success: false; error: string }> {
  if (!AUTH_RESEND_KEY) {
    return { success: false, error: "AUTH_RESEND_KEY not configured" }
  }

  const { subject, html } = composeDeletionEmail(args)
  const resend = new Resend(AUTH_RESEND_KEY)

  try {
    await resend.emails.send({
      from: EMAIL_FROM,
      to: args.to,
      subject,
      html,
    })
    return { success: true }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to send deletion email"
    return { success: false, error: message }
  }
}
