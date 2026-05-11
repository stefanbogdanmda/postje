import { describe, it, expect } from "vitest"
import { composeDeletionEmail } from "../deletion-email"

const APP_URL = "https://test.example.com"

describe("composeDeletionEmail", () => {
  it("subject mentions confirmation and the cooling-off period", () => {
    const { subject } = composeDeletionEmail({
      to: "user@example.com",
      scheduledFor: new Date("2026-05-13T10:00:00Z"),
      cancelToken: "token-123",
      appUrl: APP_URL,
    })

    expect(subject).toMatch(/Bevestiging/i)
    expect(subject).toMatch(/24 uur/i)
  })

  it("includes a cancel URL with the token as a query parameter", () => {
    const { html } = composeDeletionEmail({
      to: "user@example.com",
      scheduledFor: new Date("2026-05-13T10:00:00Z"),
      cancelToken: "token-abc-123",
      appUrl: APP_URL,
    })

    expect(html).toContain(
      `${APP_URL}/api/account/deletion/cancel?token=token-abc-123`
    )
  })

  it("HTML-escapes the email field", () => {
    const { html } = composeDeletionEmail({
      to: '"<script>alert(1)</script>"@example.com',
      scheduledFor: new Date("2026-05-13T10:00:00Z"),
      cancelToken: "token-123",
      appUrl: APP_URL,
    })

    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("HTML-escapes the cancel token (defense-in-depth)", () => {
    const { html } = composeDeletionEmail({
      to: "user@example.com",
      scheduledFor: new Date("2026-05-13T10:00:00Z"),
      cancelToken: 'token"<script>',
      appUrl: APP_URL,
    })

    expect(html).not.toContain('token"<script>')
  })

  it("includes the scheduledFor formatted in Europe/Amsterdam", () => {
    const { html } = composeDeletionEmail({
      to: "user@example.com",
      scheduledFor: new Date("2026-05-13T10:00:00Z"),
      cancelToken: "token-123",
      appUrl: APP_URL,
    })

    // 10:00 UTC on May 13, 2026 = 12:00 CEST (UTC+2)
    expect(html).toMatch(/12:00/)
    expect(html).toMatch(/13 mei 2026|13-05-2026|2026/)
  })
})
