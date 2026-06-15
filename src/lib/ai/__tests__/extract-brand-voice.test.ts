import { describe, it, expect } from "vitest"
import {
  buildExtractSystemPrompt,
  buildExtractUserPrompt,
  normalizeDraft,
} from "../extract-brand-voice"

describe("buildExtractSystemPrompt", () => {
  it("bakes in the guardrails", () => {
    const p = buildExtractSystemPrompt()
    expect(p).toMatch(/never invent banned phrases/i)
    expect(p).toMatch(/verbatim quotes/i)
    expect(p).toMatch(/valid json only/i)
    expect(p).toContain('"bannedPhrases"')
    expect(p).toContain('"examplePosts"')
  })
})

describe("buildExtractUserPrompt", () => {
  it("includes the business name and the transcript", () => {
    const p = buildExtractUserPrompt("Café de Hoek", "we focus on regulars")
    expect(p).toContain("Café de Hoek")
    expect(p).toContain("we focus on regulars")
  })
})

describe("normalizeDraft (guardrail layer)", () => {
  it("returns safe empty defaults for empty/garbage input", () => {
    expect(normalizeDraft(null)).toEqual({
      toneOfVoice: "",
      targetCustomers: "",
      brandPersonality: "",
      bannedPhrases: [],
      examplePosts: [],
      notes: "",
    })
    expect(normalizeDraft("nonsense")).toEqual({
      toneOfVoice: "",
      targetCustomers: "",
      brandPersonality: "",
      bannedPhrases: [],
      examplePosts: [],
      notes: "",
    })
  })

  it("coerces non-array banned/example fields to empty arrays (never invented)", () => {
    const d = normalizeDraft({ bannedPhrases: "culinair", examplePosts: 42 })
    expect(d.bannedPhrases).toEqual([])
    expect(d.examplePosts).toEqual([])
  })

  it("trims strings and filters non-strings/blanks out of arrays", () => {
    const d = normalizeDraft({
      toneOfVoice: "  warm, direct  ",
      bannedPhrases: ["culinair", "", 5, "  geniet van  "],
      examplePosts: ["Verse koffie ☕", null],
    })
    expect(d.toneOfVoice).toBe("warm, direct")
    expect(d.bannedPhrases).toEqual(["culinair", "geniet van"])
    expect(d.examplePosts).toEqual(["Verse koffie ☕"])
  })

  it("passes through valid fields unchanged", () => {
    const d = normalizeDraft({
      toneOfVoice: "Warm en direct",
      targetCustomers: "vaste gasten, gezinnen",
      brandPersonality: "nuchter, gastvrij",
      bannedPhrases: ["culinair"],
      examplePosts: ["Erwtensoep vandaag."],
      notes: "Confident on tone; no banned phrases mentioned.",
    })
    expect(d.bannedPhrases).toEqual(["culinair"])
    expect(d.examplePosts).toEqual(["Erwtensoep vandaag."])
    expect(d.notes).toContain("Confident")
  })
})
