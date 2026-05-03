import { describe, expect, test } from "bun:test"
import { TERMINAL_KEY_MAP } from "../../src/terminal-key"
import { applyKeyToQuery, TerminalStatusBar } from "../../src/vim/terminal-status-bar"

describe("applyKeyToQuery", () => {
  function keyEvt(overrides: Record<string, unknown> = {}) {
    return { stopPropagation: () => {}, preventDefault: () => {}, ...overrides }
  }

  test("Backspace with non-empty query removes last character", () => {
    expect(applyKeyToQuery(keyEvt({ key: "Backspace" }), "hello")).toBe("hell")
  })

  test("Backspace with empty query returns empty string", () => {
    expect(applyKeyToQuery(keyEvt({ key: "Backspace" }), "")).toBe("")
  })

  test("printable character is appended to query", () => {
    expect(applyKeyToQuery(keyEvt({ key: "a" }), "hello")).toBe("helloa")
  })

  test("modifier key (Ctrl-a) returns query unchanged", () => {
    expect(applyKeyToQuery(keyEvt({ key: "a", ctrlKey: true }), "hello")).toBe("hello")
  })

  test("Alt modifier key returns query unchanged", () => {
    expect(applyKeyToQuery(keyEvt({ key: "a", altKey: true }), "hello")).toBe("hello")
  })

  test("Meta modifier key returns query unchanged", () => {
    expect(applyKeyToQuery(keyEvt({ key: "a", metaKey: true }), "hello")).toBe("hello")
  })

  test("Shift modifier key returns query unchanged", () => {
    expect(applyKeyToQuery(keyEvt({ key: "A", shiftKey: true }), "hello")).toBe("hello")
  })

  test("non-printable key (Escape) returns query unchanged", () => {
    expect(applyKeyToQuery(keyEvt({ key: "Escape" }), "hello")).toBe("hello")
  })
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
