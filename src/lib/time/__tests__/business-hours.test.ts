import { describe, it, expect } from "vitest"
import { isWithinNLBusinessHours } from "../business-hours"

describe("isWithinNLBusinessHours", () => {
  // Helper: create a UTC Date that corresponds to a specific Amsterdam wall-clock time.
  // CET (winter) = UTC+1, CEST (summer) = UTC+2.
  // We pick fixed dates whose offset is unambiguous.

  it("returns true for Monday 10:00 Amsterdam (winter, CET)", () => {
    // 2026-01-12 (Mon) 10:00 CET = 09:00 UTC
    const now = new Date("2026-01-12T09:00:00Z")
    expect(isWithinNLBusinessHours(now)).toBe(true)
  })

  it("returns true for Monday 10:00 Amsterdam (summer, CEST)", () => {
    // 2026-07-13 (Mon) 10:00 CEST = 08:00 UTC
    const now = new Date("2026-07-13T08:00:00Z")
    expect(isWithinNLBusinessHours(now)).toBe(true)
  })

  it("returns false for Monday 08:59 Amsterdam", () => {
    // 2026-01-12 (Mon) 08:59 CET = 07:59 UTC
    const now = new Date("2026-01-12T07:59:00Z")
    expect(isWithinNLBusinessHours(now)).toBe(false)
  })

  it("returns true for Monday 09:00 Amsterdam (inclusive lower bound)", () => {
    const now = new Date("2026-01-12T08:00:00Z")
    expect(isWithinNLBusinessHours(now)).toBe(true)
  })

  it("returns true for Monday 17:59 Amsterdam", () => {
    // 2026-01-12 (Mon) 17:59 CET = 16:59 UTC
    const now = new Date("2026-01-12T16:59:00Z")
    expect(isWithinNLBusinessHours(now)).toBe(true)
  })

  it("returns false for Monday 18:00 Amsterdam (exclusive upper bound)", () => {
    const now = new Date("2026-01-12T17:00:00Z")
    expect(isWithinNLBusinessHours(now)).toBe(false)
  })

  it("returns false for Saturday 12:00 Amsterdam", () => {
    // 2026-01-17 is a Saturday
    const now = new Date("2026-01-17T11:00:00Z")
    expect(isWithinNLBusinessHours(now)).toBe(false)
  })

  it("returns false for Sunday 12:00 Amsterdam", () => {
    // 2026-01-18 is a Sunday
    const now = new Date("2026-01-18T11:00:00Z")
    expect(isWithinNLBusinessHours(now)).toBe(false)
  })

  it("handles DST forward transition (last Sun of March)", () => {
    // 2026-03-29 03:30 CEST = 01:30 UTC (clocks jumped from 02:00 CET to 03:00 CEST at 01:00 UTC)
    // Sunday anyway, so result is false — but the call must not throw.
    const now = new Date("2026-03-29T01:30:00Z")
    expect(isWithinNLBusinessHours(now)).toBe(false)
  })

  it("handles DST backward transition (last Sun of October)", () => {
    // 2026-10-25 02:30 CET — clocks fell back from 03:00 CEST to 02:00 CET
    const now = new Date("2026-10-25T01:30:00Z")
    expect(isWithinNLBusinessHours(now)).toBe(false)
  })
})
