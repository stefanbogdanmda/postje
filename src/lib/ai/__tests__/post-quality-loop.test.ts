import { describe, it, expect, vi } from "vitest"
import { runPostQualityLoop, type RewriteDayFn, type DayPostDraft } from "../post-quality-loop"

function makeDraft(overrides: Partial<DayPostDraft> = {}): DayPostDraft {
  return {
    day: overrides.day ?? "Tuesday",
    instagramCaption: overrides.instagramCaption ?? "Goedemorgen! Tijd voor koffie.",
    facebookPost: overrides.facebookPost ?? "Koffie klaar. Kom langs!",
    reasoning: overrides.reasoning ?? "Morning theme",
    englishSummary: overrides.englishSummary ?? "Good morning, time for coffee",
  }
}

const LONG_SENTENCE =
  "Dit is een veel te lange zin die absoluut over de limiet van vijftien woorden gaat heel duidelijk hier."

describe("runPostQualityLoop", () => {
  it("returns drafts unchanged when initial validation is clean", async () => {
    const rewrite = vi.fn<RewriteDayFn>()
    const drafts = [makeDraft({ day: "Tuesday" }), makeDraft({ day: "Wednesday" })]

    const result = await runPostQualityLoop(drafts, {
      bannedPhrases: [],
      rewrite,
    })

    expect(rewrite).not.toHaveBeenCalled()
    expect(result.posts).toHaveLength(2)
    expect(result.posts[0].warnings).toEqual([])
    expect(result.posts[1].warnings).toEqual([])
    expect(result.attempts).toEqual([
      { day: "Tuesday", attempts: 1, clean: true },
      { day: "Wednesday", attempts: 1, clean: true },
    ])
  })

  it("rewrites a dirty day once and exits when the rewrite is clean", async () => {
    const dirty = makeDraft({
      day: "Tuesday",
      instagramCaption: "Kom genieten van onze koffie!",
    })
    const cleanRewrite = makeDraft({
      day: "Tuesday",
      instagramCaption: "Goede koffie wacht op je.",
    })
    const rewrite = vi.fn<RewriteDayFn>().mockResolvedValue(cleanRewrite)

    const result = await runPostQualityLoop([dirty], {
      bannedPhrases: ["genieten"],
      rewrite,
    })

    expect(rewrite).toHaveBeenCalledTimes(1)
    const [draftArg, feedbackArg] = rewrite.mock.calls[0]
    expect(draftArg.instagramCaption).toBe("Kom genieten van onze koffie!")
    expect(feedbackArg).toContain("genieten")
    expect(feedbackArg).toContain("instagram")

    expect(result.posts[0].instagramCaption).toBe("Goede koffie wacht op je.")
    expect(result.posts[0].warnings).toEqual([])
    expect(result.attempts[0]).toEqual({ day: "Tuesday", attempts: 2, clean: true })
  })

  it("stops at maxAttemptsPerDay and returns the latest attempt with warnings", async () => {
    const dirty = makeDraft({ instagramCaption: "Kom genieten vandaag!" })
    // Rewriter is broken — it keeps producing banned content
    const rewrite = vi
      .fn<RewriteDayFn>()
      .mockResolvedValue(makeDraft({ instagramCaption: "Nog steeds genieten!" }))

    const result = await runPostQualityLoop([dirty], {
      bannedPhrases: ["genieten"],
      rewrite,
      maxAttemptsPerDay: 3,
    })

    // 1 initial + 2 retries = 3 attempts total
    expect(rewrite).toHaveBeenCalledTimes(2)
    expect(result.attempts[0]).toEqual({
      day: "Tuesday",
      attempts: 3,
      clean: false,
    })
    expect(result.posts[0].warnings.length).toBeGreaterThan(0)
    expect(result.posts[0].instagramCaption).toBe("Nog steeds genieten!")
  })

  it("only rewrites the dirty days, leaves clean days untouched", async () => {
    const cleanDay = makeDraft({ day: "Tuesday" })
    const dirtyDay = makeDraft({ day: "Wednesday", facebookPost: LONG_SENTENCE })
    const fixed = makeDraft({ day: "Wednesday", facebookPost: "Korte zin. Klaar." })
    const rewrite = vi.fn<RewriteDayFn>().mockResolvedValue(fixed)

    const result = await runPostQualityLoop([cleanDay, dirtyDay], {
      bannedPhrases: [],
      rewrite,
    })

    expect(rewrite).toHaveBeenCalledTimes(1)
    expect(rewrite.mock.calls[0][0].day).toBe("Wednesday")
    expect(result.attempts).toEqual([
      { day: "Tuesday", attempts: 1, clean: true },
      { day: "Wednesday", attempts: 2, clean: true },
    ])
  })

  it("passes warnings from both platforms into the feedback string", async () => {
    const dirty = makeDraft({
      instagramCaption: "Kom genieten!",
      facebookPost: LONG_SENTENCE,
    })
    const rewrite = vi
      .fn<RewriteDayFn>()
      .mockResolvedValue(makeDraft())

    await runPostQualityLoop([dirty], {
      bannedPhrases: ["genieten"],
      rewrite,
    })

    const feedback = rewrite.mock.calls[0][1]
    expect(feedback).toContain("instagram")
    expect(feedback).toContain("facebook")
    expect(feedback).toContain("genieten")
  })
})
