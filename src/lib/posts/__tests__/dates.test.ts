import { describe, it, expect } from "vitest"
import {
  dayNameToDate,
  getDateRange,
  getGenerationWeekRange,
  getGenerationWeekStart,
} from "../dates"

describe("dayNameToDate", () => {
  it("maps Tuesday to the start date", () => {
    expect(dayNameToDate("Tuesday", "2026-05-12")).toBe("2026-05-12")
  })

  it("maps Monday to start date + 6", () => {
    expect(dayNameToDate("Monday", "2026-05-12")).toBe("2026-05-18")
  })

  it("maps Wednesday to start date + 1", () => {
    expect(dayNameToDate("Wednesday", "2026-05-12")).toBe("2026-05-13")
  })

  it("maps Sunday to start date + 5", () => {
    expect(dayNameToDate("Sunday", "2026-05-12")).toBe("2026-05-17")
  })

  it("handles month boundary", () => {
    expect(dayNameToDate("Monday", "2026-05-26")).toBe("2026-06-01")
  })

  it("throws for unknown day name", () => {
    expect(() => dayNameToDate("Funday", "2026-05-12")).toThrow("Unknown day name")
  })
})

describe("getDateRange", () => {
  it("returns 7 dates starting from startDate", () => {
    const dates = getDateRange("2026-05-12")
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe("2026-05-12")
    expect(dates[6]).toBe("2026-05-18")
  })

  it("handles year boundary", () => {
    const dates = getDateRange("2026-12-29")
    expect(dates[3]).toBe("2027-01-01")
  })
})

describe("getGenerationWeekStart", () => {
  it("uses Tuesday as the first day of the generation week", () => {
    expect(getGenerationWeekStart(new Date(2026, 4, 12))).toBe("2026-05-12")
  })

  it("maps Monday to the previous Tuesday", () => {
    expect(getGenerationWeekStart(new Date(2026, 4, 18))).toBe("2026-05-12")
  })

  it("returns Tuesday-through-Monday range", () => {
    expect(getGenerationWeekRange(new Date(2026, 4, 18))).toEqual({
      startDate: "2026-05-12",
      endDate: "2026-05-18",
    })
  })
})
