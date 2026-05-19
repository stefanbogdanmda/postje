import { describe, it, expect } from "vitest"
import { validatePosts } from "../validate-posts"

function makePost(overrides: Partial<{
  day: string
  instagramCaption: string
  facebookPost: string
  reasoning: string
  englishSummary: string
}> = {}) {
  return {
    day: overrides.day ?? "Tuesday",
    instagramCaption: overrides.instagramCaption ?? "Goedemorgen! Tijd voor koffie.",
    facebookPost: overrides.facebookPost ?? "Koffie klaar. Kom langs!",
    reasoning: overrides.reasoning ?? "Morning coffee theme",
    englishSummary: overrides.englishSummary ?? "Good morning, time for coffee",
  }
}

describe("validatePosts", () => {
  it("returns posts with empty warnings when content is clean", () => {
    const posts = [makePost()]
    const result = validatePosts(posts, [])

    expect(result).toHaveLength(1)
    expect(result[0].warnings).toEqual([])
  })

  it("preserves original post fields", () => {
    const posts = [makePost({ day: "Wednesday", reasoning: "test" })]
    const result = validatePosts(posts, [])

    expect(result[0].day).toBe("Wednesday")
    expect(result[0].reasoning).toBe("test")
    expect(result[0].instagramCaption).toBe("Goedemorgen! Tijd voor koffie.")
    expect(result[0].facebookPost).toBe("Koffie klaar. Kom langs!")
  })

  describe("banned phrases", () => {
    it("detects banned phrase in Instagram caption", () => {
      const posts = [makePost({ instagramCaption: "Kom genieten van onze culinaire ervaring!" })]
      const result = validatePosts(posts, ["culinaire ervaring"])

      expect(result[0].warnings).toHaveLength(1)
      expect(result[0].warnings[0].type).toBe("banned_phrase")
      expect(result[0].warnings[0].platform).toBe("instagram")
      expect(result[0].warnings[0].detail).toContain("culinaire ervaring")
    })

    it("detects banned phrase in Facebook post", () => {
      const posts = [makePost({ facebookPost: "Ontdek onze unieke smaakbeleving!" })]
      const result = validatePosts(posts, ["smaakbeleving"])

      expect(result[0].warnings).toHaveLength(1)
      expect(result[0].warnings[0].platform).toBe("facebook")
    })

    it("detects banned phrase in both platforms", () => {
      const posts = [makePost({
        instagramCaption: "Kom genieten bij ons!",
        facebookPost: "Tijd om te genieten!",
      })]
      const result = validatePosts(posts, ["genieten"])

      expect(result[0].warnings).toHaveLength(2)
      expect(result[0].warnings[0].platform).toBe("instagram")
      expect(result[0].warnings[1].platform).toBe("facebook")
    })

    it("is case-insensitive", () => {
      const posts = [makePost({ instagramCaption: "GEZELLIG hier!" })]
      const result = validatePosts(posts, ["gezellig"])

      expect(result[0].warnings).toHaveLength(1)
    })

    it("detects multiple banned phrases", () => {
      const posts = [makePost({
        instagramCaption: "Kom genieten van onze culinaire ervaring!",
      })]
      const result = validatePosts(posts, ["genieten", "culinaire ervaring"])

      expect(result[0].warnings).toHaveLength(2)
    })

    it("no warning when phrase is absent", () => {
      const posts = [makePost({ instagramCaption: "Koffie klaar." })]
      const result = validatePosts(posts, ["gezellig"])

      expect(result[0].warnings).toHaveLength(0)
    })
  })

  describe("long sentence detection", () => {
    it("warns when a sentence exceeds 15 words", () => {
      const longSentence = "Dit is een heel lang zin die veel te veel woorden bevat en echt niet goed is voor social media posts."
      const posts = [makePost({ instagramCaption: longSentence })]
      const result = validatePosts(posts, [])

      const longWarnings = result[0].warnings.filter((w) => w.type === "long_sentence")
      expect(longWarnings.length).toBeGreaterThan(0)
      expect(longWarnings[0].platform).toBe("instagram")
    })

    it("does not warn for sentences under 15 words", () => {
      const posts = [makePost({
        instagramCaption: "Kort en krachtig. Zo moet het.",
        facebookPost: "Twee woorden. Klaar.",
      })]
      const result = validatePosts(posts, [])

      expect(result[0].warnings).toHaveLength(0)
    })

    it("detects long sentences on both platforms independently", () => {
      const long = "Dit is een enorm lange zin met heel veel woorden die absoluut niet past in een goede social media post."
      const posts = [makePost({
        instagramCaption: long,
        facebookPost: long,
      })]
      const result = validatePosts(posts, [])

      const igWarnings = result[0].warnings.filter((w) => w.platform === "instagram")
      const fbWarnings = result[0].warnings.filter((w) => w.platform === "facebook")
      expect(igWarnings.length).toBeGreaterThan(0)
      expect(fbWarnings.length).toBeGreaterThan(0)
    })

    it("handles exactly 15 words without warning", () => {
      // Exactly 15 words
      const exact = "Een twee drie vier vijf zes zeven acht negen tien elf twaalf dertien veertien vijftien."
      const posts = [makePost({ instagramCaption: exact })]
      const result = validatePosts(posts, [])

      expect(result[0].warnings).toHaveLength(0)
    })
  })

  describe("multiple posts", () => {
    it("validates each post independently", () => {
      const posts = [
        makePost({ day: "Tuesday", instagramCaption: "Genieten vandaag!" }),
        makePost({ day: "Wednesday", instagramCaption: "Alles is goed." }),
      ]
      const result = validatePosts(posts, ["genieten"])

      expect(result[0].warnings).toHaveLength(1) // Tuesday has banned phrase
      expect(result[1].warnings).toHaveLength(0) // Wednesday is clean
    })

    it("returns same number of posts as input", () => {
      const posts = Array.from({ length: 7 }, (_, i) =>
        makePost({ day: `Day ${i + 1}` })
      )
      const result = validatePosts(posts, [])

      expect(result).toHaveLength(7)
    })
  })

  describe("combined warnings", () => {
    it("can have both banned phrase and long sentence warnings", () => {
      const long = "Dit is een heel lange zin met een genieten woord dat verboden is en ook veel te lang is voor een post."
      const posts = [makePost({ instagramCaption: long })]
      const result = validatePosts(posts, ["genieten"])

      const types = result[0].warnings.map((w) => w.type)
      expect(types).toContain("banned_phrase")
      expect(types).toContain("long_sentence")
    })
  })
})
