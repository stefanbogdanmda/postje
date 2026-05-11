import { describe, it, expect } from "vitest"
import { composeRegenLimitEmail } from "../regen-limit-email"
import type { RegenLimitPost } from "@/lib/posts/repository"

const SAMPLE_POST: RegenLimitPost = {
  id: "post-123",
  clientId: "client-456",
  businessName: "Café De Hoek",
  platform: "instagram",
  scheduledDate: "2026-05-12",
  content: "Onze nieuwe lente menu is er! Verse asperges, geitenkaas, en zonneschijn op het bord. ☀️🥗 #LenteOpHetMenu",
  rejectionCount: 3,
}

const APP_URL = "https://social-ai.example.com"

describe("composeRegenLimitEmail", () => {
  it("includes the client business name in the subject", () => {
    const { subject } = composeRegenLimitEmail(SAMPLE_POST, APP_URL)
    expect(subject).toContain("Café De Hoek")
  })

  it("mentions the regeneration count in the subject or body", () => {
    const { subject, html } = composeRegenLimitEmail(SAMPLE_POST, APP_URL)
    expect(subject + html).toMatch(/3/)
  })

  it("includes the platform name in the body", () => {
    const { html } = composeRegenLimitEmail(SAMPLE_POST, APP_URL)
    expect(html).toContain("Instagram")
  })

  it("includes the post content in the body", () => {
    const { html } = composeRegenLimitEmail(SAMPLE_POST, APP_URL)
    expect(html).toContain("Onze nieuwe lente menu")
  })

  it("includes a link to the client admin page", () => {
    const { html } = composeRegenLimitEmail(SAMPLE_POST, APP_URL)
    expect(html).toContain(`${APP_URL}/admin/clients/client-456`)
  })

  it("includes the scheduled date in the body", () => {
    const { html } = composeRegenLimitEmail(SAMPLE_POST, APP_URL)
    expect(html).toContain("2026-05-12")
  })

  it("renders Facebook platform correctly", () => {
    const fbPost = { ...SAMPLE_POST, platform: "facebook" as const }
    const { html } = composeRegenLimitEmail(fbPost, APP_URL)
    expect(html).toContain("Facebook")
  })

  it("escapes HTML in user content to prevent injection", () => {
    const evilPost = { ...SAMPLE_POST, content: '<script>alert("xss")</script>' }
    const { html } = composeRegenLimitEmail(evilPost, APP_URL)
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("escapes HTML in business name to prevent injection", () => {
    const evilPost = { ...SAMPLE_POST, businessName: 'Café <img src=x>' }
    const { html } = composeRegenLimitEmail(evilPost, APP_URL)
    expect(html).not.toContain("<img src=x>")
    expect(html).toContain("&lt;img src=x&gt;")
  })
})
