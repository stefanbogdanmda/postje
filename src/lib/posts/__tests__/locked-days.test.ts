import { describe, it, expect } from "vitest"
import { buildLockedDaysContext } from "../locked-days"
import type { LockedDay } from "../types"

describe("buildLockedDaysContext", () => {
  it("returns empty string when no locked days", () => {
    const result = buildLockedDaysContext([], ["2026-05-12", "2026-05-13"])
    expect(result).toBe("")
  })

  it("formats locked days with photo info", () => {
    const locked: LockedDay[] = [
      { scheduledDate: "2026-05-12", hasPhoto: true },
      { scheduledDate: "2026-05-13", hasPhoto: false },
    ]
    const openDates = ["2026-05-14", "2026-05-15"]

    const result = buildLockedDaysContext(locked, openDates)

    expect(result).toContain("LOCKED:")
    expect(result).toContain("2026-05-12: photo assigned")
    expect(result).toContain("2026-05-13: text-only")
    expect(result).toContain("OPEN (plan these):")
    expect(result).toContain("2026-05-14")
    expect(result).toContain("2026-05-15")
  })

  it("returns empty string when all days are open (no locked context needed)", () => {
    const result = buildLockedDaysContext([], ["2026-05-12", "2026-05-13", "2026-05-14"])
    expect(result).toBe("")
  })
})
