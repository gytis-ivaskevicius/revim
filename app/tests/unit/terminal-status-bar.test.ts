import { describe, expect, test } from "bun:test"
import { TERMINAL_KEY_MAP } from "../../src/terminal-key"
import { applyKeyToQuery, TerminalStatusBar } from "../../src/vim/terminal-status-bar"

describe("applyKeyToQuery", () => {
  test("Backspace with non-empty query removes last character", () => {
    const evt = { key: "Backspace", stopPropagation: () => {}, preventDefault: () => {} }
    expect(applyKeyToQuery(evt, "hello")).toBe("hell")
  })

  test("Backspace with empty query returns empty string", () => {
    const evt = { key: "Backspace", stopPropagation: () => {}, preventDefault: () => {} }
    expect(applyKeyToQuery(evt, "")).toBe("")
  })

  test("printable character is appended to query", () => {
    const evt = { key: "a", stopPropagation: () => {}, preventDefault: () => {} }
    expect(applyKeyToQuery(evt, "hello")).toBe("helloa")
  })

  test("modifier key (Ctrl-a) returns query unchanged", () => {
    const evt = { key: "a", ctrlKey: true, stopPropagation: () => {}, preventDefault: () => {} }
    expect(applyKeyToQuery(evt, "hello")).toBe("hello")
  })

  test("Alt modifier key returns query unchanged", () => {
    const evt = { key: "a", altKey: true, stopPropagation: () => {}, preventDefault: () => {} }
    expect(applyKeyToQuery(evt, "hello")).toBe("hello")
  })

  test("Meta modifier key returns query unchanged", () => {
    const evt = { key: "a", metaKey: true, stopPropagation: () => {}, preventDefault: () => {} }
    expect(applyKeyToQuery(evt, "hello")).toBe("hello")
  })

  test("Shift modifier key returns query unchanged", () => {
    const evt = { key: "A", shiftKey: true, stopPropagation: () => {}, preventDefault: () => {} }
    expect(applyKeyToQuery(evt, "hello")).toBe("hello")
  })

  test("non-printable key (Escape) returns query unchanged", () => {
    const evt = { key: "Escape", stopPropagation: () => {}, preventDefault: () => {} }
    expect(applyKeyToQuery(evt, "hello")).toBe("hello")
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

  // Named keys — all map 1:1 to themselves (or remap like Space→" " and Esc→"Escape")
  const namedKeyCases: Array<[string, string]> = [
    ["Tab", "Tab"],
    ["Delete", "Delete"],
    ["Home", "Home"],
    ["End", "End"],
    ["PageUp", "PageUp"],
    ["PageDown", "PageDown"],
    ["Insert", "Insert"],
    ["Enter", "Enter"],
    ["Escape", "Escape"],
    ["Esc", "Escape"],
    ["Backspace", "Backspace"],
    ["Space", " "],
    ["Up", "Up"],
    ["Down", "Down"],
    ["Left", "Left"],
    ["Right", "Right"],
  ]
  for (const [encoded, expected] of namedKeyCases) {
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

  test("decodeKey round-trips all keys in TERMINAL_KEY_MAP", () => {
    for (const [encoded, expected] of Object.entries(TERMINAL_KEY_MAP)) {
      const result = decodeKey(encoded)
      expect(result).not.toBeNull()
      expect(result!.key).toBe(expected)
      expect(result!.ctrlKey).toBeUndefined()
      expect(result!.altKey).toBeUndefined()
      expect(result!.shiftKey).toBeUndefined()
    }
  })
})
