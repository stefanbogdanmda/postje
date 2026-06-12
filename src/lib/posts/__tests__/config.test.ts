import { describe, it, expect } from "vitest"
import {
  clampPostsPerWeek,
  MIN_POSTS_PER_WEEK,
  MAX_POSTS_PER_WEEK,
  DEFAULT_POSTS_PER_WEEK,
} from "../config"

describe("clampPostsPerWeek", () => {
  it("keeps values already in range", () => {
    expect(clampPostsPerWeek(3)).toBe(3)
    expect(clampPostsPerWeek(5)).toBe(5)
    expect(clampPostsPerWeek(6)).toBe(6)
  })

  it("clamps below the minimum up to the minimum", () => {
    expect(clampPostsPerWeek(0)).toBe(MIN_POSTS_PER_WEEK)
    expect(clampPostsPerWeek(-4)).toBe(MIN_POSTS_PER_WEEK)
    expect(clampPostsPerWeek(2)).toBe(MIN_POSTS_PER_WEEK)
  })

  it("clamps above the maximum down to the maximum", () => {
    expect(clampPostsPerWeek(7)).toBe(MAX_POSTS_PER_WEEK)
    expect(clampPostsPerWeek(100)).toBe(MAX_POSTS_PER_WEEK)
  })

  it("rounds fractional values", () => {
    expect(clampPostsPerWeek(4.4)).toBe(4)
    expect(clampPostsPerWeek(4.6)).toBe(5)
  })

  it("falls back to the default for non-finite input", () => {
    expect(clampPostsPerWeek(NaN)).toBe(DEFAULT_POSTS_PER_WEEK)
    expect(clampPostsPerWeek(Infinity)).toBe(DEFAULT_POSTS_PER_WEEK)
  })
})
