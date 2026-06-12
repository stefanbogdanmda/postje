import { describe, it, expect } from "vitest"
import { composeFlagAlertEmail, type FlagAlert } from "../flag-email"

const SAMPLE: FlagAlert = {
  clientId: "client-456",
  businessName: "Café De Hoek",
  platform: "instagram",
  scheduledDate: "2026-05-12",
  content: "Onze nieuwe lente menu is er! ☀️",
  reason: "Verkeerde openingstijden genoemd",
}

const APP_URL = "https://postje.example.com"

describe("composeFlagAlertEmail", () => {
  it("names the business in the subject", () => {
    const { subject } = composeFlagAlertEmail(SAMPLE, APP_URL)
    expect(subject).toContain("Café De Hoek")
  })

  it("includes platform, scheduled date, content and reason", () => {
    const { html } = composeFlagAlertEmail(SAMPLE, APP_URL)
    expect(html).toContain("Instagram")
    expect(html).toContain("2026-05-12")
    expect(html).toContain("Onze nieuwe lente menu")
    expect(html).toContain("Verkeerde openingstijden genoemd")
  })

  it("links to the client's admin page", () => {
    const { html } = composeFlagAlertEmail(SAMPLE, APP_URL)
    expect(html).toContain(`${APP_URL}/admin/clients/client-456`)
  })

  it("omits the reason block when no reason is given", () => {
    const { html } = composeFlagAlertEmail({ ...SAMPLE, reason: null }, APP_URL)
    expect(html).not.toContain("Reden:")
  })

  it("escapes HTML in client-supplied fields", () => {
    const { html } = composeFlagAlertEmail(
      { ...SAMPLE, reason: "<script>alert(1)</script>" },
      APP_URL
    )
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })
})
