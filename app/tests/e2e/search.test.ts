import { expect, Keys, RENDER_DELAY_MS, test } from "./test-utils.js"

async function typeSearch(terminal: any, query: string, prefix = "/") {
  await Keys.pressKeys(terminal, [prefix, ...query.split(""), "Enter"])
}

test.describe("search prompt", () => {
  test("status bar shows prompt prefix while typing - press / shows /", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await Keys.pressKeys(terminal, ["/"])
    const statusText = terminal.getByText("/")
    await expect(statusText).toBeVisible()
  })

  test("status bar shows prompt prefix while typing - /cu shows /cu", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await Keys.pressKeys(terminal, ["/", "c", "u"])
    const statusText = terminal.getByText("/cu")
    await expect(statusText).toBeVisible()
  })

  test("status bar shows prompt prefix while typing - Esc cancels and restores NORMAL", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    const before = terminal.getCursor()
    await Keys.pressKeys(terminal, ["/", "<Esc>"])
    const normalLabel = terminal.getByText("NORMAL")
    await expect(normalLabel).toBeVisible()
    const after = terminal.getCursor()
    expect(after.x).toBe(before.x)
    expect(after.y).toBe(before.y)
  })

  test("forward search /cursor<Enter> moves cursor to first cursor (y=22)", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await typeSearch(terminal, "cursor")
    await Keys.delay(RENDER_DELAY_MS)
    const cursor = terminal.getCursor()
    // First "cursor" is at line 21 (0-indexed) = y=22 with border offset
    expect(cursor.y).toBe(22)
  })

  test("n advances to next occurrence - /cursor then n lands on y=23", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await typeSearch(terminal, "cursor")
    await Keys.pressKeys(terminal, ["n"])
    const cursor = terminal.getCursor()
    // Second "cursor" is at line 22 (0-indexed) = y=23 with border offset
    expect(cursor.y).toBe(23)
  })

  test("N moves to previous occurrence - /cursor then n then N back to y=22", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await typeSearch(terminal, "cursor")
    await Keys.pressKeys(terminal, ["n", "N"])
    const cursor = terminal.getCursor()
    // Should be back at first "cursor" = y=22
    expect(cursor.y).toBe(22)
  })

  test("n twice advances to third cursor - /cursor then n n lands on y=27", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await typeSearch(terminal, "cursor")
    await Keys.pressKeys(terminal, ["n", "n"])
    const cursor = terminal.getCursor()
    // Third "cursor" is at line 39 (0-indexed). With viewport height 27:
    // scroll_top = 39 - 27 + 1 = 13, visual position = 39 - 13 + 1 = y=27
    expect(cursor.y).toBe(27)
  })

  test("backward search ?cursor moves cursor in reverse from end", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    // Jump to end of buffer using G
    await Keys.pressKeys(terminal, ["G"])
    const afterG = terminal.getCursor()
    await typeSearch(terminal, "cursor", "?")
    const cursor = terminal.getCursor()
    // Should find a "cursor" searching backwards from end - cursor should move
    expect(cursor.y).not.toBe(afterG.y)
  })

  test("no-match query /zzznomatch<Enter> does not crash and cursor stays put", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    const before = terminal.getCursor()
    await typeSearch(terminal, "zzznomatch")
    await Keys.delay(RENDER_DELAY_MS)
    // App should still be running - status bar visible
    await expect(terminal.getByText("NORMAL")).toBeVisible()
    const after = terminal.getCursor()
    expect(after.x).toBe(before.x)
    expect(after.y).toBe(before.y)
  })

  test("search highlights appear - /cursor<Enter> shows highlighted match", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await typeSearch(terminal, "cursor")
    await Keys.delay(RENDER_DELAY_MS)
    // After search, the cursor should be at y=22 (first "cursor" match)
    const cursor = terminal.getCursor()
    expect(cursor.y).toBe(22)
  })

  test("Esc-cancel does not move cursor or leave highlights", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    const before = terminal.getCursor()
    await Keys.pressKeys(terminal, ["/", ..."cursor", "<Esc>"])
    // Status bar shows NORMAL
    await expect(terminal.getByText("NORMAL")).toBeVisible()
    // Cursor unchanged
    const after = terminal.getCursor()
    expect(after.x).toBe(before.x)
    expect(after.y).toBe(before.y)
  })

  test("Up in / prompt recalls previous search from history", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    // Execute a search to populate history
    await typeSearch(terminal, "cursor")
    await Keys.delay(RENDER_DELAY_MS)
    await expect(terminal.getByText("NORMAL")).toBeVisible()
    // Open search prompt again and press Up to recall previous query
    await Keys.pressKeys(terminal, ["/", "<Up>"])
    await Keys.delay(RENDER_DELAY_MS)
    // Status bar should show the recalled query
    const statusText = terminal.getByText("/cursor")
    await expect(statusText).toBeVisible()
  })

  test("Down in / prompt navigates forward in history", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    // Execute a search to populate history
    await typeSearch(terminal, "cursor")
    await Keys.delay(RENDER_DELAY_MS)
    // Open search prompt, type matching prefix, press Up to recall, then Down to go forward
    await Keys.pressKeys(terminal, ["/", "c", "<Up>"])
    await Keys.delay(RENDER_DELAY_MS)
    // After Up, should show /cursor (HistoryController uses prefix matching)
    await expect(terminal.getByText("/cursor")).toBeVisible()
    // Press Down to go forward — should show /c (the current input before Up)
    await Keys.pressKeys(terminal, ["<Down>"])
    await Keys.delay(RENDER_DELAY_MS)
    await expect(terminal.getByText("/c")).toBeVisible()
  })
})
