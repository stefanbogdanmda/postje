import { describe, it, expect } from "vitest"
import { composePostsReadyEmail } from "../ready-email"

const APP_URL = "https://postje.example.com"

describe("composePostsReadyEmail", () => {
  it("includes the business name, count and a dashboard link", () => {
    const { subject, html } = composePostsReadyEmail("Café de Hoek", 4, APP_URL)
    expect(html).toContain("Café de Hoek")
    expect(html).toContain("4 nieuwe posts")
    expect(html).toContain(`${APP_URL}/dashboard`)
    expect(subject).toContain("posts")
  })

  it("uses the singular for a single post", () => {
    const { subject, html } = composePostsReadyEmail("Tandarts X", 1, APP_URL)
    expect(html).toContain("1 nieuwe post")
    expect(subject).toContain("post")
    expect(subject).not.toContain("posts")
  })

  it("escapes HTML in the business name (XSS guard)", () => {
    const { html } = composePostsReadyEmail("<script>alert(1)</script>", 2, APP_URL)
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })
})
