import { describe, it, expect } from "vitest"
import { composeStalePostEmail } from "../stale-post-email"
import type { StalePost } from "@/lib/posts/repository"

const SAMPLE_POST: StalePost = {
  id: "post-123",
  clientId: "client-456",
  businessName: "Café De Hoek",
  platform: "instagram",
  scheduledDate: "2026-05-12",
  content: "Onze nieuwe lente menu is er! Verse asperges, geitenkaas, en zonneschijn op het bord. ☀️🥗 #LenteOpHetMenu",
  firstSeenAt: new Date("2026-05-11T10:00:00Z"),
}

const APP_URL = "https://social-ai.example.com"

describe("composeStalePostEmail", () => {
  it("includes the client business name in the subject", () => {
    const { subject } = composeStalePostEmail(SAMPLE_POST, APP_URL)
    expect(subject).toContain("Café De Hoek")
  })

  it("includes the platform name in the body", () => {
    const { html } = composeStalePostEmail(SAMPLE_POST, APP_URL)
    expect(html).toContain("Instagram")
  })

  it("includes the post content (or a preview of it) in the body", () => {
    const { html } = composeStalePostEmail(SAMPLE_POST, APP_URL)
    expect(html).toContain("Onze nieuwe lente menu")
  })

  it("includes a link to the client admin page", () => {
    const { html } = composeStalePostEmail(SAMPLE_POST, APP_URL)
    expect(html).toContain(`${APP_URL}/admin/clients/client-456`)
  })

  it("includes the scheduled date in the body", () => {
    const { html } = composeStalePostEmail(SAMPLE_POST, APP_URL)
    expect(html).toContain("2026-05-12")
  })

  it("renders Facebook platform correctly", () => {
    const fbPost = { ...SAMPLE_POST, platform: "facebook" as const }
    const { html } = composeStalePostEmail(fbPost, APP_URL)
    expect(html).toContain("Facebook")
  })

  it("escapes HTML in user content to prevent injection", () => {
    const evilPost = { ...SAMPLE_POST, content: '<script>alert("xss")</script>' }
    const { html } = composeStalePostEmail(evilPost, APP_URL)
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })
})
