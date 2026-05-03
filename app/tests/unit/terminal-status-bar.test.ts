import { describe, expect, test } from "bun:test"
import { TERMINAL_KEY_MAP } from "../../src/terminal-key"
import { applyKeyToQuery, TerminalStatusBar } from "../../src/vim/terminal-status-bar"

describe("applyKeyToQuery", () => {
  function keyEvt(overrides: Record<string, unknown> = {}) {
    return { stopPropagation: () => {}, preventDefault: () => {}, ...overrides }
  }

  const applyCases: Array<[string, Record<string, unknown>, string, string]> = [
    ["Backspace removes last char", { key: "Backspace" }, "hello", "hell"],
    ["Backspace on empty query no-ops", { key: "Backspace" }, "", ""],
    ["printable char is appended", { key: "a" }, "hello", "helloa"],
    ["Ctrl modifier returns unchanged", { key: "a", ctrlKey: true }, "hello", "hello"],
    ["Alt modifier returns unchanged", { key: "a", altKey: true }, "hello", "hello"],
    ["Meta modifier returns unchanged", { key: "a", metaKey: true }, "hello", "hello"],
    ["Shift modifier returns unchanged", { key: "A", shiftKey: true }, "hello", "hello"],
    ["non-printable key returns unchanged", { key: "Escape" }, "hello", "hello"],
  ]
  for (const [label, evtOverrides, query, expected] of applyCases) {
    test(label, () => {
      expect(applyKeyToQuery(keyEvt(evtOverrides), query)).toBe(expected)
    })
  }
})

describe("decodeKey", () => {
  function decodeKey(encodedKey: string) {
    return (new TerminalStatusBar() as any).decodeKey(encodedKey)
  }

  const defaultMethods = {
    stopPropagation: expect.any(Function),
    preventDefault: expect.any(Function),
  }

  // Named keys — driven from TERMINAL_KEY_MAP to stay in sync
  for (const [encoded, expected] of Object.entries(TERMINAL_KEY_MAP)) {
    test(`decodeKey('${encoded}') returns { key: '${expected}' }`, () => {
      const result = decodeKey(encoded)
      expect(result).not.toBeNull()
      expect(result!.key).toBe(expected)
      expect(result).toMatchObject(defaultMethods)
    })
  }

  // Shift + arrow keys
  const shiftArrowCases = ["Left", "Right", "Up", "Down"]
  for (const dir of shiftArrowCases) {
    test(`decodeKey('Shift-${dir}') returns { key: '${dir}', shiftKey: true }`, () => {
      const result = decodeKey(`Shift-${dir}`)
      expect(result).not.toBeNull()
      expect(result!.key).toBe(dir)
      expect(result!.shiftKey).toBe(true)
    })
  }

  // Single modifier + letter
  const singleModifierCases: Array<[string, string, Record<string, boolean>]> = [
    ["Ctrl-a", "a", { ctrlKey: true }],
    ["Alt-a", "a", { altKey: true }],
  ]
  for (const [encoded, expectedKey, mods] of singleModifierCases) {
    test(`decodeKey('${encoded}') returns { key: '${expectedKey}', ... }`, () => {
      const result = decodeKey(encoded)
      expect(result).not.toBeNull()
      expect(result!.key).toBe(expectedKey)
      for (const [mod, val] of Object.entries(mods)) {
        expect((result as any)[mod]).toBe(val)
      }
    })
  }

  // Compound modifiers — multiple modifiers stacked
  const compoundModifierCases: Array<[string, string, Record<string, boolean>]> = [
    ["Shift-Ctrl-A", "A", { ctrlKey: true, shiftKey: true }],
    ["Ctrl-Shift-A", "A", { ctrlKey: true, shiftKey: true }],
    ["Alt-Ctrl-a", "a", { altKey: true, ctrlKey: true }],
  ]
  for (const [encoded, expectedKey, mods] of compoundModifierCases) {
    test(`decodeKey('${encoded}') returns { key: '${expectedKey}', ... }`, () => {
      const result = decodeKey(encoded)
      expect(result).not.toBeNull()
      expect(result!.key).toBe(expectedKey)
      for (const [mod, val] of Object.entries(mods)) {
        expect((result as any)[mod]).toBe(val)
      }
    })
  }

  test("decodeKey(\"'a'\") returns { key: 'a' } for printable char", () => {
    const result = decodeKey("'a'")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("a")
  })

  test("decodeKey('nonexistent') returns null", () => {
    const result = decodeKey("nonexistent")
    expect(result).toBeNull()
  })

  // Round-trip verification is covered by the named keys loop above
})
