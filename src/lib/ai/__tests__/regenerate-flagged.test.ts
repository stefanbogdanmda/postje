import { describe, it, expect, vi } from "vitest"
import { validatePosts } from "../validate-posts"
import {
  summarizeViolations,
  buildCorrectionUserPrompt,
  correctFlaggedPosts,
  type ValidatedDayPost,
} from "../regenerate-flagged"

const BANNED = ["culinair"]

function flagged(instagram: string, facebook = "Kort en goed."): ValidatedDayPost {
  return validatePosts(
    [
      {
        day: "Tuesday",
        instagramCaption: instagram,
        facebookPost: facebook,
        reasoning: "r",
        englishSummary: "s",
      },
    ],
    BANNED
  )[0]
}

describe("summarizeViolations", () => {
  it("describes banned phrases and long sentences; empty when clean", () => {
    const post = flagged(
      "Onze culinaire reis met heel veel woorden die maar door blijven gaan en gaan en gaan en gaan zeker"
    )
    const s = summarizeViolations(post.warnings)
    expect(s).toMatch(/banned phrases/i)
    expect(s).toMatch(/under 15 words/i)
    expect(summarizeViolations([])).toBe("")
  })
})

describe("buildCorrectionUserPrompt", () => {
  it("includes the day, the violations and both current captions", () => {
    const post = flagged("Onze culinaire reis ☕")
    const p = buildCorrectionUserPrompt(post, "Remove these banned phrases — x.")
    expect(p).toContain("Tuesday")
    expect(p).toContain("Remove these banned phrases")
    expect(p).toContain("Onze culinaire reis")
    expect(p).toContain('"instagramCaption"')
  })
})

describe("correctFlaggedPosts", () => {
  it("does not call the regenerator for a clean post", async () => {
    const clean = flagged("Verse koffie vandaag ☕")
    expect(clean.warnings).toHaveLength(0)
    const regen = vi.fn()
    const { posts, correctedDays } = await correctFlaggedPosts(
      [clean],
      BANNED,
      regen
    )
    expect(regen).not.toHaveBeenCalled()
    expect(correctedDays).toEqual([])
    expect(posts[0]).toBe(clean)
  })

  it("fixes a flagged post when the rewrite passes", async () => {
    const bad = flagged("Onze culinaire reis begint hier ☕")
    expect(bad.warnings.length).toBeGreaterThan(0)
    const regen = vi.fn(async () => ({
      instagramCaption: "Verse koffie vandaag ☕",
      facebookPost: "Tot zo!",
    }))
    const { posts, correctedDays } = await correctFlaggedPosts([bad], BANNED, regen)
    expect(regen).toHaveBeenCalledTimes(1)
    expect(posts[0].warnings).toHaveLength(0)
    expect(posts[0].instagramCaption).toBe("Verse koffie vandaag ☕")
    expect(correctedDays).toEqual(["Tuesday"])
  })

  it("keeps the original when the rewrite is no better (one round)", async () => {
    const bad = flagged("Onze culinaire reis ☕")
    const regen = vi.fn(async () => ({
      instagramCaption: "Nog steeds culinair hier ☕",
      facebookPost: "Tot zo!",
    }))
    const { posts, correctedDays } = await correctFlaggedPosts([bad], BANNED, regen)
    expect(regen).toHaveBeenCalledTimes(1)
    expect(posts[0]).toBe(bad)
    expect(correctedDays).toEqual([])
  })

  it("keeps the original when regeneration throws", async () => {
    const bad = flagged("Onze culinaire reis ☕")
    const regen = vi.fn(async () => {
      throw new Error("API overloaded")
    })
    const { posts, correctedDays } = await correctFlaggedPosts([bad], BANNED, regen)
    expect(posts[0]).toBe(bad)
    expect(correctedDays).toEqual([])
  })

  it("stops early when a round makes no progress, even with rounds left", async () => {
    const bad = flagged("Onze culinaire reis ☕")
    const regen = vi.fn(async () => ({
      instagramCaption: "Nog steeds culinair ☕",
      facebookPost: "Tot zo!",
    }))
    const { posts } = await correctFlaggedPosts([bad], BANNED, regen, 2)
    // round 1 doesn't reduce warnings → we stop rather than burn the 2nd call
    expect(posts[0]).toBe(bad)
    expect(regen).toHaveBeenCalledTimes(1)
  })
})
