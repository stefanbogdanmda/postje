import { describe, it, expect } from "vitest"
import { extractJSON } from "../extract-json"

describe("extractJSON", () => {
  it("parses plain JSON object", () => {
    const result = extractJSON<{ name: string }>('{"name": "test"}')
    expect(result).toEqual({ name: "test" })
  })

  it("parses plain JSON array", () => {
    const result = extractJSON<number[]>("[1, 2, 3]")
    expect(result).toEqual([1, 2, 3])
  })

  it("extracts JSON from markdown code fence", () => {
    const raw = '```json\n{"name": "test"}\n```'
    const result = extractJSON<{ name: string }>(raw)
    expect(result).toEqual({ name: "test" })
  })

  it("extracts JSON from code fence without language tag", () => {
    const raw = '```\n{"count": 42}\n```'
    const result = extractJSON<{ count: number }>(raw)
    expect(result).toEqual({ count: 42 })
  })

  it("extracts JSON when there is surrounding text before", () => {
    const raw = 'Here is the plan:\n{"days": ["Monday"]}'
    const result = extractJSON<{ days: string[] }>(raw)
    expect(result).toEqual({ days: ["Monday"] })
  })

  it("throws when JSON has trailing non-JSON text (no fence)", () => {
    // extractJSON only strips markdown fences and leading text.
    // Trailing text after JSON causes JSON.parse to fail.
    const raw = "Here are the results: [1, 2, 3] end of response"
    expect(() => extractJSON(raw)).toThrow()
  })

  it("extracts JSON array from code fence with surrounding text", () => {
    const raw = "Here are the results:\n```json\n[1, 2, 3]\n```\nDone."
    const result = extractJSON<number[]>(raw)
    expect(result).toEqual([1, 2, 3])
  })

  it("handles whitespace around the JSON", () => {
    const raw = '  \n  {"key": "value"}  \n  '
    const result = extractJSON<{ key: string }>(raw)
    expect(result).toEqual({ key: "value" })
  })

  it("handles nested JSON objects", () => {
    const raw = '{"outer": {"inner": "value"}}'
    const result = extractJSON<{ outer: { inner: string } }>(raw)
    expect(result).toEqual({ outer: { inner: "value" } })
  })

  it("prefers code fence content over surrounding text", () => {
    const raw = 'Some text {"wrong": true}\n```json\n{"correct": true}\n```'
    const result = extractJSON<{ correct: boolean }>(raw)
    expect(result).toEqual({ correct: true })
  })

  it("handles multiline JSON in code fence", () => {
    const raw = '```json\n{\n  "day": "Tuesday",\n  "theme": "coffee"\n}\n```'
    const result = extractJSON<{ day: string; theme: string }>(raw)
    expect(result).toEqual({ day: "Tuesday", theme: "coffee" })
  })

  it("throws for empty string", () => {
    expect(() => extractJSON("")).toThrow()
  })

  it("throws for text with no JSON", () => {
    expect(() => extractJSON("This is just plain text")).toThrow(
      "No JSON object or array found"
    )
  })

  it("throws for malformed JSON", () => {
    expect(() => extractJSON('{"broken: true')).toThrow()
  })

  it("throws for empty code fence", () => {
    expect(() => extractJSON("```json\n\n```")).toThrow()
  })

  it("throws when JSON has trailing content without fence", () => {
    // The function finds { but JSON.parse fails on trailing text
    const raw = 'text {"a": 1} and [1,2]'
    expect(() => extractJSON(raw)).toThrow()
  })

  it("extracts JSON that ends at end of string", () => {
    const raw = 'Some intro text: {"a": 1}'
    const result = extractJSON<{ a: number }>(raw)
    expect(result).toEqual({ a: 1 })
  })
})
