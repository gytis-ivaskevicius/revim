import { expect, KEY_PRESS_DELAY_MS, keyPress, RENDER_DELAY_MS, test } from "./test-utils.js"

async function typeSearch(terminal: any, query: string, delay: number) {
  keyPress(terminal, "/")
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

  test("forward search /cursor<Enter> moves cursor to line 3", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await typeSearch(terminal, "cursor", KEY_PRESS_DELAY_MS)
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    const cursor = terminal.getCursor()
    expect(cursor.y).toBe(3)
  })

  test("forward search /demo<Enter> moves cursor to line 2", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await typeSearch(terminal, "demo", KEY_PRESS_DELAY_MS)
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    const cursor = terminal.getCursor()
    expect(cursor.y).toBe(2)
  })

  test("n advances to next occurrence - /cursor then n lands on line 4", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await typeSearch(terminal, "cursor", KEY_PRESS_DELAY_MS)
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    keyPress(terminal, "n")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    const cursor = terminal.getCursor()
    expect(cursor.y).toBe(4)
  })

  test("n advances to next occurrence - /cursor then n twice lands on line 6", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await typeSearch(terminal, "cursor", KEY_PRESS_DELAY_MS)
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    keyPress(terminal, "n")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    keyPress(terminal, "n")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    const cursor = terminal.getCursor()
    expect(cursor.y).toBe(6)
  })

  test("N moves to previous occurrence - /cursor then n then N back to line 3", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await typeSearch(terminal, "cursor", KEY_PRESS_DELAY_MS)
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    keyPress(terminal, "n")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    keyPress(terminal, "N")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    const cursor = terminal.getCursor()
    expect(cursor.y).toBe(3)
  })

  test("backward search ?cursor moves cursor in reverse from line 6", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    // Move to last content line (line 6)
    for (let i = 0; i < 6; i++) {
      terminal.keyDown()
      await new Promise((r) => setTimeout(r, KEY_PRESS_DELAY_MS))
    }
    keyPress(terminal, "?")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    for (const ch of "cursor") {
      keyPress(terminal, ch)
      await new Promise((r) => setTimeout(r, KEY_PRESS_DELAY_MS))
    }
    keyPress(terminal, "Enter")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    const cursor = terminal.getCursor()
    expect(cursor.y).toBeLessThanOrEqual(4)
  })

  test("search wrap-around - /cursor then n thrice returns to line 3", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await typeSearch(terminal, "cursor", KEY_PRESS_DELAY_MS)
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    keyPress(terminal, "n")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    keyPress(terminal, "n")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    keyPress(terminal, "n")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    const cursor = terminal.getCursor()
    expect(cursor.y).toBe(3)
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
    // At least one "cursor" text should be visible
    const match = terminal.getByText("cursor")
    await expect(match).toBeVisible()
    // Snapshot to verify highlights (REVERSED cells)
    const snapshot = await terminal.toMatchSnapshot({ includeColors: true })
    // Find a cell with inverse styling on line 3 (first match)
    const hasInverse = snapshot.some((cell: any) => cell.inverse === true)
    expect(hasInverse).toBe(true)
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
    // No REVERSED cells on line 3 (no highlights)
    const snapshot = await terminal.toMatchSnapshot({ includeColors: true })
    const hasInverse = snapshot.some((cell: any) => cell.inverse === true)
    expect(hasInverse).toBe(false)
  })
})
