import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test"

// Tracks calls to setStatusText
const setStatusTextCalls: string[] = []
let mockCursorPos = { line: 0, ch: 0 }
let mockCurrentPath: string | null = null
let mockTerminalWidth = 80

mock.module("@revim/core", () => {
  return {
    setStatusText: (text: string) => {
      setStatusTextCalls.push(text)
    },
    getCursorPos: () => mockCursorPos,
    getCurrentPath: () => mockCurrentPath,
    getTerminalWidth: () => mockTerminalWidth,
    focusEditor: () => {},
  }
})

// Import after mock is set up
const { TerminalStatusBar } = await import("../../src/vim/terminal-status-bar")

describe("TerminalStatusBar - startDisplay", () => {
  beforeEach(() => {
    setStatusTextCalls.length = 0
    mockCursorPos = { line: 0, ch: 0 }
    mockCurrentPath = null
    mockTerminalWidth = 80
  })

  test("startDisplay shows message and isPrompting returns false", () => {
    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0 // clear construction calls

    bar.startDisplay("3 substitutions on 2 lines")

    expect(setStatusTextCalls).toContain("3 substitutions on 2 lines")
    expect(bar.isPrompting()).toBe(false)
  })

  test("closer returned by startDisplay restores mode label", () => {
    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0

    const closer = bar.startDisplay("display message")
    expect(setStatusTextCalls).toContain("display message")

    setStatusTextCalls.length = 0
    closer()

    // After close, update() should be called with mode label
    expect(setStatusTextCalls.some((t) => t.startsWith("NORMAL"))).toBe(true)
  })

  test("startDisplay called while previous is active replaces message", () => {
    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0

    const closer1 = bar.startDisplay("first message")
    expect(setStatusTextCalls).toContain("first message")

    setStatusTextCalls.length = 0
    const closer2 = bar.startDisplay("second message")
    expect(setStatusTextCalls).toContain("second message")

    // Closing the first closer should restore the current display ("second message"), not the older one
    setStatusTextCalls.length = 0
    closer1()
    expect(setStatusTextCalls.some((t) => t.startsWith("second message"))).toBe(true)

    // Closing the second closer should restore mode (no more displays)
    setStatusTextCalls.length = 0
    closer2()
    expect(setStatusTextCalls.some((t) => t.startsWith("NORMAL"))).toBe(true)
  })
})

describe("TerminalStatusBar - showNotification", () => {
  beforeEach(() => {
    setStatusTextCalls.length = 0
    mockCursorPos = { line: 0, ch: 0 }
    mockCurrentPath = null
    mockTerminalWidth = 80
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test("showNotification shows message immediately", () => {
    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0

    bar.showNotification("E21: Cannot make changes")

    expect(setStatusTextCalls).toContain("E21: Cannot make changes")
  })

  test("notification auto-clears after 3 seconds", () => {
    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0

    bar.showNotification("notification message")
    expect(setStatusTextCalls).toContain("notification message")

    setStatusTextCalls.length = 0
    jest.advanceTimersByTime(3000)

    expect(setStatusTextCalls.some((t) => t.startsWith("NORMAL"))).toBe(true)
  })

  test("showNotification while previous is visible replaces it", () => {
    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0

    bar.showNotification("first notification")
    expect(setStatusTextCalls).toContain("first notification")

    setStatusTextCalls.length = 0
    bar.showNotification("second notification")
    expect(setStatusTextCalls).toContain("second notification")
    expect(setStatusTextCalls).not.toContain("first notification")

    // After the timeout, only the mode should be restored (no double-clear issues)
    setStatusTextCalls.length = 0
    jest.advanceTimersByTime(3000)
    expect(setStatusTextCalls.some((t) => t.startsWith("NORMAL"))).toBe(true)
  })

  test("setMode during notification clears the timeout", () => {
    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0

    bar.showNotification("notification message")
    expect(setStatusTextCalls).toContain("notification message")

    setStatusTextCalls.length = 0
    bar.setMode({ mode: "insert" })

    // Should call setStatusText with INSERT mode
    expect(setStatusTextCalls.some((t) => t.startsWith("INSERT"))).toBe(true)

    // After the original 3s timeout, the notification should NOT reappear
    setStatusTextCalls.length = 0
    jest.advanceTimersByTime(3000)
    expect(setStatusTextCalls.length).toBe(0)
  })

  test("setKeyBuffer during notification clears the timeout", () => {
    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0

    bar.showNotification("notification message")
    expect(setStatusTextCalls).toContain("notification message")

    setStatusTextCalls.length = 0
    bar.setKeyBuffer("2d")

    // Should show mode+buffer
    expect(setStatusTextCalls.some((t) => t.includes("2d"))).toBe(true)

    // After the original 3s timeout, the notification should NOT reappear
    setStatusTextCalls.length = 0
    jest.advanceTimersByTime(3000)
    expect(setStatusTextCalls.length).toBe(0)
  })

  test("startDisplay then showNotification - notification takes priority", () => {
    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0

    const closer = bar.startDisplay("display message")
    expect(setStatusTextCalls).toContain("display message")

    setStatusTextCalls.length = 0
    bar.showNotification("notification message")
    expect(setStatusTextCalls).toContain("notification message")
    expect(setStatusTextCalls).not.toContain("display message")

    // After notification clears, display message is NOT restored
    setStatusTextCalls.length = 0
    jest.advanceTimersByTime(3000)
    expect(setStatusTextCalls.some((t) => t.startsWith("NORMAL"))).toBe(true)
    expect(setStatusTextCalls).not.toContain("display message")

    // But the display state still exists - it would show if update() is called with no notification
    // Actually, closer() should restore mode since display state was overridden by notification
    setStatusTextCalls.length = 0
    closer()
    expect(setStatusTextCalls.some((t) => t.startsWith("NORMAL"))).toBe(true)
  })

  test("startPrompt takes priority over display", () => {
    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0

    bar.startDisplay("display message")
    expect(setStatusTextCalls).toContain("display message")

    setStatusTextCalls.length = 0
    const promptCloser = bar.startPrompt("/", "search", { onKeyDown: () => false })
    expect(setStatusTextCalls).toContain("/")

    // After prompt closes, display message is NOT restored
    setStatusTextCalls.length = 0
    promptCloser()
    expect(setStatusTextCalls.some((t) => t.startsWith("NORMAL"))).toBe(true)
    expect(setStatusTextCalls).not.toContain("display message")
  })
})

describe("TerminalStatusBar - cursor position and filename", () => {
  beforeEach(() => {
    setStatusTextCalls.length = 0
    mockCursorPos = { line: 0, ch: 0 }
    mockCurrentPath = null
    mockTerminalWidth = 80
  })

  test("status bar shows filename and cursor position (1-indexed)", () => {
    mockCurrentPath = "/tmp/test.txt"
    mockCursorPos = { line: 0, ch: 0 }
    mockTerminalWidth = 80

    const _bar = new TerminalStatusBar()
    const lastCall = setStatusTextCalls[setStatusTextCalls.length - 1]

    expect(lastCall).toContain("test.txt")
    expect(lastCall).toMatch(/1:1$/) // 1-indexed, right-aligned
  })

  test("status bar shows [No Name] when no file path", () => {
    mockCurrentPath = null
    mockCursorPos = { line: 0, ch: 0 }
    mockTerminalWidth = 80

    const _bar = new TerminalStatusBar()
    const lastCall = setStatusTextCalls[setStatusTextCalls.length - 1]

    expect(lastCall).toContain("[No Name]")
  })

  test("status bar shows [No Name] when file path is empty string", () => {
    mockCurrentPath = ""
    mockCursorPos = { line: 0, ch: 0 }
    mockTerminalWidth = 80

    const _bar = new TerminalStatusBar()
    const lastCall = setStatusTextCalls[setStatusTextCalls.length - 1]

    expect(lastCall).toContain("[No Name]")
  })

  test("cursor position updates on setCursorPos", () => {
    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0

    mockCursorPos = { line: 5, ch: 3 }
    bar.setCursorPos(5, 3)

    const lastCall = setStatusTextCalls[setStatusTextCalls.length - 1]
    expect(lastCall).toMatch(/6:4$/) // 1-indexed
  })

  test("mode change shows correct label", () => {
    mockCurrentPath = null
    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0

    bar.setMode({ mode: "insert" })

    const lastCall = setStatusTextCalls[setStatusTextCalls.length - 1]
    expect(lastCall).toMatch(/^INSERT/)
  })

  test("key buffer shown in status bar", () => {
    mockCurrentPath = null
    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0

    bar.setKeyBuffer("2d")

    const lastCall = setStatusTextCalls[setStatusTextCalls.length - 1]
    expect(lastCall).toMatch(/^NORMAL/)
    expect(lastCall).toContain("2d")
  })

  test("filename updates via setFilePath", () => {
    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0

    bar.setFilePath("/path/to/myfile.txt")

    const lastCall = setStatusTextCalls[setStatusTextCalls.length - 1]
    expect(lastCall).toContain("myfile.txt")
  })

  test("right section is right-aligned with padding", () => {
    mockCurrentPath = "/tmp/f.txt"
    mockCursorPos = { line: 0, ch: 0 }
    mockTerminalWidth = 40
    // leftSection = "NORMAL  f.txt" = 12 chars
    // rightSection = "1:1" = 3 chars
    // padding = 40 - 12 - 3 = 25 spaces

    const _bar = new TerminalStatusBar()
    const lastCall = setStatusTextCalls[setStatusTextCalls.length - 1]

    // The line:col "1:1" should be right up against the right edge
    // So the string should end with spaces + "1:1"
    // leftSection = "NORMAL  f.txt" = 13 chars, padding = 40 - 13 - 3 = 24
    expect(lastCall).toMatch(/ {24}1:1$/)
  })

  test("right section is truncated when terminal is too narrow", () => {
    mockCurrentPath = "/tmp/very-long-filename.txt"
    mockCursorPos = { line: 10, ch: 5 }
    mockTerminalWidth = 20
    // leftSection = "NORMAL  very-long-filename.txt" = 30 chars
    // Already longer than 20, so should be truncated

    const _bar = new TerminalStatusBar()
    const lastCall = setStatusTextCalls[setStatusTextCalls.length - 1]

    // Should be truncated to fit within 20 chars
    expect(lastCall.length).toBeLessThanOrEqual(20)
  })

  test("right section truncated from left when partially fitting", () => {
    mockCurrentPath = "/tmp/f.txt"
    mockCursorPos = { line: 10, ch: 5 }
    mockTerminalWidth = 20
    // leftSection = "NORMAL  f.txt" = 12 chars
    // rightSection = "11:6" = 4 chars
    // total = 16 chars, padding = 4, fits fine

    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0

    // Make left section longer
    bar.setKeyBuffer("dddw")
    // leftSection = "NORMAL  dddw  f.txt" = 18 chars
    // rightSection = "11:6" = 4 chars
    // total = 22 > 20, so right section should be truncated from left

    const lastCall = setStatusTextCalls[setStatusTextCalls.length - 1]
    // leftSection takes 18 chars, only 2 left for right section
    // rightSection "11:6" truncated to last 2 chars: ":6"
    expect(lastCall.length).toBeLessThanOrEqual(20)
  })

  test("no left section overflow when terminal is very narrow", () => {
    mockCurrentPath = null
    mockCursorPos = { line: 0, ch: 0 }
    mockTerminalWidth = 5

    const _bar = new TerminalStatusBar()
    const lastCall = setStatusTextCalls[setStatusTextCalls.length - 1]

    // Should be truncated to fit (max 5 chars)
    expect(lastCall.length).toBeLessThanOrEqual(5)
  })
})

describe("TerminalStatusBar - priority ordering", () => {
  beforeEach(() => {
    setStatusTextCalls.length = 0
    mockCursorPos = { line: 0, ch: 0 }
    mockCurrentPath = null
    mockTerminalWidth = 80
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test("prompt takes priority over notification", () => {
    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0

    bar.showNotification("notification")
    bar.startPrompt(":", "ex command", { onKeyDown: () => false })

    // Last call should be the prompt prefix, not "notification"
    const lastCall = setStatusTextCalls[setStatusTextCalls.length - 1]
    expect(lastCall).toBe(":")
  })

  test("notification takes priority over display", () => {
    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0

    bar.startDisplay("display message")
    bar.showNotification("notification message")

    const lastCall = setStatusTextCalls[setStatusTextCalls.length - 1]
    expect(lastCall).toBe("notification message")
  })

  test("display takes priority over mode+buffer", () => {
    const bar = new TerminalStatusBar()
    setStatusTextCalls.length = 0

    bar.startDisplay("display message")
    // setMode is called, but display should still show
    bar.setMode({ mode: "insert" })

    const lastCall = setStatusTextCalls[setStatusTextCalls.length - 1]
    expect(lastCall).toBe("display message")
  })
})
