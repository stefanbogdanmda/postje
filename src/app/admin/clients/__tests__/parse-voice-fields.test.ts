import { describe, it, expect } from "vitest"
import { parseLines, parseExamplePosts } from "../parse-voice-fields"

describe("parseLines (banned phrases)", () => {
  it("returns an empty array for null or empty input", () => {
    expect(parseLines(null)).toEqual([])
    expect(parseLines("")).toEqual([])
    expect(parseLines("   ")).toEqual([])
  })

  it("splits on newlines and trims each phrase", () => {
    expect(parseLines("culinair\ngeniet van\n  passie voor  ")).toEqual([
      "culinair",
      "geniet van",
      "passie voor",
    ])
  })

  it("drops blank lines", () => {
    expect(parseLines("een\n\n\ntwee\n   \nvier")).toEqual([
      "een",
      "twee",
      "vier",
    ])
  })
})

describe("parseExamplePosts", () => {
  it("returns an empty array for null or empty input", () => {
    expect(parseExamplePosts(null)).toEqual([])
    expect(parseExamplePosts("")).toEqual([])
    expect(parseExamplePosts("\n  \n")).toEqual([])
  })

  it("separates posts on blank lines and keeps multi-line posts intact", () => {
    const input = "Eerste post.\nTweede regel.\n\nAndere post hier."
    expect(parseExamplePosts(input)).toEqual([
      "Eerste post.\nTweede regel.",
      "Andere post hier.",
    ])
  })

  it("treats runs of blank lines (incl. whitespace) as one separator", () => {
    const input = "Een\n\n\n  \n\nTwee"
    expect(parseExamplePosts(input)).toEqual(["Een", "Twee"])
  })
})
