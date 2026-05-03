import { describe, expect, test } from "bun:test"
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
  function newTerminalStatusBar(): TerminalStatusBar {
    return new TerminalStatusBar()
  }

  function decodeKey(tsb: TerminalStatusBar, encodedKey: string) {
    // Access private method via bracket notation for testing
    return (tsb as any).decodeKey(encodedKey)
  }

  const defaultMethods = {
    stopPropagation: expect.any(Function),
    preventDefault: expect.any(Function),
  }

  test("decodeKey('Tab') returns { key: 'Tab' }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Tab")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("Tab")
    expect(result).toMatchObject(defaultMethods)
  })

  test("decodeKey('Delete') returns { key: 'Delete' }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Delete")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("Delete")
  })

  test("decodeKey('Home') returns { key: 'Home' }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Home")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("Home")
  })

  test("decodeKey('End') returns { key: 'End' }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "End")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("End")
  })

  test("decodeKey('PageUp') returns { key: 'PageUp' }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "PageUp")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("PageUp")
  })

  test("decodeKey('PageDown') returns { key: 'PageDown' }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "PageDown")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("PageDown")
  })

  test("decodeKey('Shift-Left') returns { key: 'Left', shiftKey: true }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Shift-Left")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("Left")
    expect(result!.shiftKey).toBe(true)
  })

  test("decodeKey('Shift-Right') returns { key: 'Right', shiftKey: true }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Shift-Right")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("Right")
    expect(result!.shiftKey).toBe(true)
  })

  test("decodeKey('Shift-Up') returns { key: 'Up', shiftKey: true }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Shift-Up")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("Up")
    expect(result!.shiftKey).toBe(true)
  })

  test("decodeKey('Shift-Down') returns { key: 'Down', shiftKey: true }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Shift-Down")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("Down")
    expect(result!.shiftKey).toBe(true)
  })

  test("decodeKey('Enter') returns { key: 'Enter' }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Enter")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("Enter")
  })

  test("decodeKey('Escape') returns { key: 'Escape' }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Escape")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("Escape")
  })

  test("decodeKey('Esc') returns { key: 'Escape' }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Esc")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("Escape")
  })

  test("decodeKey('Backspace') returns { key: 'Backspace' }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Backspace")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("Backspace")
  })

  test("decodeKey('Space') returns { key: ' ' }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Space")
    expect(result).not.toBeNull()
    expect(result!.key).toBe(" ")
  })

  test("decodeKey('Up') returns { key: 'Up' }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Up")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("Up")
  })

  test("decodeKey('Down') returns { key: 'Down' }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Down")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("Down")
  })

  test("decodeKey('Left') returns { key: 'Left' }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Left")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("Left")
  })

  test("decodeKey('Right') returns { key: 'Right' }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Right")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("Right")
  })

  test("decodeKey('Ctrl-a') returns { key: 'a', ctrlKey: true }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Ctrl-a")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("a")
    expect(result!.ctrlKey).toBe(true)
  })

  test("decodeKey('Alt-a') returns { key: 'a', altKey: true }", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "Alt-a")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("a")
    expect(result!.altKey).toBe(true)
  })

  test("decodeKey(\"'a'\") returns { key: 'a' } for printable char", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "'a'")
    expect(result).not.toBeNull()
    expect(result!.key).toBe("a")
  })

  test("decodeKey('nonexistent') returns null", () => {
    const tsb = newTerminalStatusBar()
    const result = decodeKey(tsb, "nonexistent")
    expect(result).toBeNull()
  })
})
