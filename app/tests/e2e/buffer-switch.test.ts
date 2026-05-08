import { expect, Keys, test, withFiles } from "./test-utils.js"

const DEMO_FIXTURE = "app/tests/fixtures/demo-content.md"
const BUFFER2_FIXTURE = "app/tests/fixtures/buffer2-content.md"

test.describe("buffer switching", () => {
  test("single file mode works as before (no regression)", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  })

  test("gt with single buffer is a no-op (content doesn't change)", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

    await Keys.pressKeys(terminal, ["g", "t"])
    await Keys.delay(200)

    // Content should still be the demo content
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  })
})

test.describe("buffer switching with two files", () => {
  test.use(withFiles([DEMO_FIXTURE, BUFFER2_FIXTURE]))

  test("opening two files from CLI, pressing gt, verifies second file's content", async ({ terminal }) => {
    // First file should be visible initially
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

    // Switch to next buffer with gt
    await Keys.pressKeys(terminal, ["g", "t"])
    await Keys.delay(200)

    // Should now see second file's content
    await expect(terminal.getByText("This is file number two.")).toBeVisible()
  })

  test("pressing gT returns to first file's content", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

    // Switch forward with gt
    await Keys.pressKeys(terminal, ["g", "t"])
    await Keys.delay(100)
    await expect(terminal.getByText("This is file number two.")).toBeVisible()

    // Switch back with gT
    await Keys.pressKeys(terminal, ["g", "T"])
    await Keys.delay(100)
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  })

  test(":bnext switches to next buffer", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

    await Keys.pressKeys(terminal, [":", "b", "n", "e", "x", "t", "<Enter>"])
    await Keys.delay(200)

    await expect(terminal.getByText("This is file number two.")).toBeVisible()
  })

  test(":bprev switches to previous buffer", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

    // Go to second buffer
    await Keys.pressKeys(terminal, [":", "b", "n", "e", "x", "t", "<Enter>"])
    await Keys.delay(100)
    await expect(terminal.getByText("This is file number two.")).toBeVisible()

    // Go back to first buffer
    await Keys.pressKeys(terminal, [":", "b", "p", "r", "e", "v", "<Enter>"])
    await Keys.delay(100)
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  })

  test("cursor position is preserved when switching away and back", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

    // Move cursor down a few lines using j
    const initialCursor = terminal.getCursor()
    await Keys.pressKeys(terminal, ["j", "j", "j"])
    await Keys.delay(100)
    const cursorAfterMove = terminal.getCursor()
    expect(cursorAfterMove.y).toBeGreaterThan(initialCursor.y)

    // Switch to second buffer
    await Keys.pressKeys(terminal, ["g", "t"])
    await Keys.delay(100)
    await expect(terminal.getByText("This is file number two.")).toBeVisible()

    // Switch back to first buffer
    await Keys.pressKeys(terminal, ["g", "T"])
    await Keys.delay(100)
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

    // Cursor should be at the same position (line 3)
    const cursorAfterSwitch = terminal.getCursor()
    expect(cursorAfterSwitch.y).toBe(cursorAfterMove.y)
  })

  test("undo within a buffer works after switching", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

    // Insert text in first buffer
    await Keys.pressKeys(terminal, ["i", "X", "Y", "Z", "<Esc>"])
    await Keys.delay(100)

    // Verify text was inserted
    let buffer = Keys.visibleBuffer(terminal)
    expect(buffer.includes("XYZ")).toBe(true)

    // Switch to second buffer
    await Keys.pressKeys(terminal, ["g", "t"])
    await Keys.delay(100)
    await expect(terminal.getByText("This is file number two.")).toBeVisible()

    // Switch back to first buffer
    await Keys.pressKeys(terminal, ["g", "T"])
    await Keys.delay(100)
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

    // Undo the edit
    await Keys.pressKeys(terminal, ["u"])
    await Keys.delay(100)

    buffer = Keys.visibleBuffer(terminal)
    expect(buffer.includes("XYZ")).toBe(false)
    expect(buffer.includes("Welcome to ReVim!")).toBe(true)
  })
})
