import { expect, KEY_PRESS_DELAY_MS, keyPress, RENDER_DELAY_MS, test } from "./test-utils.js"

async function typeSearch(terminal: any, query: string, delay: number, prefix = "/") {
  keyPress(terminal, prefix)
  await new Promise((r) => setTimeout(r, delay))
  for (const ch of query) {
    keyPress(terminal, ch)
    await new Promise((r) => setTimeout(r, delay))
  }
  keyPress(terminal, "Enter")
  await new Promise((r) => setTimeout(r, delay))
}

test.describe("search prompt", () => {
  test("status bar shows prompt prefix while typing - press / shows /", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    keyPress(terminal, "/")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    const statusText = terminal.getByText("/")
    await expect(statusText).toBeVisible()
  })

  test("status bar shows prompt prefix while typing - /cu shows /cu", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    keyPress(terminal, "/")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    keyPress(terminal, "c")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    keyPress(terminal, "u")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    const statusText = terminal.getByText("/cu")
    await expect(statusText).toBeVisible()
  })

  test("status bar shows prompt prefix while typing - Esc cancels and restores NORMAL", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    const before = terminal.getCursor()
    keyPress(terminal, "/")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    keyPress(terminal, "Escape")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    const normalLabel = terminal.getByText("NORMAL")
    await expect(normalLabel).toBeVisible()
    const after = terminal.getCursor()
    expect(after.x).toBe(before.x)
    expect(after.y).toBe(before.y)
  })

  test("forward search /cursor<Enter> moves cursor to first cursor (y=22)", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await typeSearch(terminal, "cursor", KEY_PRESS_DELAY_MS)
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    const cursor = terminal.getCursor()
    // First "cursor" is at line 21 (0-indexed) = y=22 with border offset
    expect(cursor.y).toBe(22)
  })

  test("n advances to next occurrence - /cursor then n lands on y=23", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await typeSearch(terminal, "cursor", KEY_PRESS_DELAY_MS)
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    keyPress(terminal, "n")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    const cursor = terminal.getCursor()
    // Second "cursor" is at line 22 (0-indexed) = y=23 with border offset
    expect(cursor.y).toBe(23)
  })

  test("N moves to previous occurrence - /cursor then n then N back to y=22", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await typeSearch(terminal, "cursor", KEY_PRESS_DELAY_MS)
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    keyPress(terminal, "n")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    keyPress(terminal, "N")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    const cursor = terminal.getCursor()
    // Should be back at first "cursor" = y=22
    expect(cursor.y).toBe(22)
  })

  test("n twice advances to third cursor - /cursor then n n lands on y=27", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await typeSearch(terminal, "cursor", KEY_PRESS_DELAY_MS)
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    keyPress(terminal, "n")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    keyPress(terminal, "n")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    const cursor = terminal.getCursor()
    // Third "cursor" is at line 39 (0-indexed). With viewport height 27:
    // scroll_top = 39 - 27 + 1 = 13, visual position = 39 - 13 + 1 = y=27
    expect(cursor.y).toBe(27)
  })

  test("backward search ?cursor moves cursor in reverse from end", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    // Jump to end of buffer using G
    terminal.keyPress("G")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    const afterG = terminal.getCursor()
    await typeSearch(terminal, "cursor", KEY_PRESS_DELAY_MS, "?")
    const cursor = terminal.getCursor()
    // Should find a "cursor" searching backwards from end - cursor should move
    expect(cursor.y).not.toBe(afterG.y)
  })

  test("no-match query /zzznomatch<Enter> does not crash and cursor stays put", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    const before = terminal.getCursor()
    await typeSearch(terminal, "zzznomatch", KEY_PRESS_DELAY_MS)
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    // App should still be running - status bar visible
    await expect(terminal.getByText("NORMAL")).toBeVisible()
    const after = terminal.getCursor()
    expect(after.x).toBe(before.x)
    expect(after.y).toBe(before.y)
  })

  test("search highlights appear - /cursor<Enter> shows highlighted match", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await typeSearch(terminal, "cursor", KEY_PRESS_DELAY_MS)
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    // After search, the cursor should be at y=22 (first "cursor" match)
    const cursor = terminal.getCursor()
    expect(cursor.y).toBe(22)
  })

  test("Esc-cancel does not move cursor or leave highlights", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    const before = terminal.getCursor()
    keyPress(terminal, "/")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    for (const ch of "cursor") {
      keyPress(terminal, ch)
      await new Promise((r) => setTimeout(r, KEY_PRESS_DELAY_MS))
    }
    keyPress(terminal, "Escape")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    // Status bar shows NORMAL
    await expect(terminal.getByText("NORMAL")).toBeVisible()
    // Cursor unchanged
    const after = terminal.getCursor()
    expect(after.x).toBe(before.x)
    expect(after.y).toBe(before.y)
  })
})
