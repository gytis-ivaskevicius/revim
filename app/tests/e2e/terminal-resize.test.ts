import { expect, Keys, RENDER_DELAY_MS, test } from "./test-utils.js"

test.describe("terminal resize", () => {
  test("wider dimensions update display", async ({ terminal }) => {
    // Initial render at 80x30
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

    // Resize to 120x40
    terminal.resize(120, 40)
    await Keys.delay(RENDER_DELAY_MS)

    // After resize, content should still be visible and status bar should show mode
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
    await expect(terminal.getByText("NORMAL")).toBeVisible()
    // Snapshot matches the expected layout at 120x40
    await expect(terminal).toMatchSnapshot({ includeColors: true })
  })

  test("smaller dimensions update display", async ({ terminal }) => {
    // Initial render at 80x30
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

    // Get initial cursor position
    const beforeCursor = terminal.getCursor()

    // Resize to 40x15
    terminal.resize(40, 15)
    await Keys.delay(RENDER_DELAY_MS)

    // After resize, status bar should still show mode label
    await expect(terminal.getByText("NORMAL")).toBeVisible()

    // Cursor should remain visible after shrink (scroll adjusts via adjust_scroll)
    const afterCursor = terminal.getCursor()
    expect(afterCursor.x).toBeGreaterThanOrEqual(0)
    expect(afterCursor.y).toBeGreaterThanOrEqual(0)
    expect(afterCursor.x).toBeLessThan(40)
    expect(afterCursor.y).toBeLessThan(15)
  })

  test("resize while search prompt is active keeps prompt visible", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

    // Open search prompt and type text
    await Keys.pressKeys(terminal, ["/", "c", "u"])
    await expect(terminal.getByText("/cu")).toBeVisible()

    // Resize while prompt is active
    terminal.resize(100, 30)
    await Keys.delay(RENDER_DELAY_MS)

    // Prompt should still be visible after resize
    await expect(terminal.getByText("/cu")).toBeVisible()
  })

  test("resize while ex command prompt is active keeps prompt visible", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

    // Open ex command prompt and type text
    await Keys.pressKeys(terminal, [":", "h", "e", "l", "l", "o"])
    await expect(terminal.getByText(":hello")).toBeVisible()

    // Resize while prompt is active
    terminal.resize(100, 30)
    await Keys.delay(RENDER_DELAY_MS)

    // Prompt should still be visible after resize
    await expect(terminal.getByText(":hello")).toBeVisible()
  })

  test("rapid consecutive resizes coalesce correctly", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

    // Simulate rapid resize events (e.g., during window drag)
    terminal.resize(120, 40)
    // Immediate second resize before the first is processed
    terminal.resize(100, 30)
    await Keys.delay(RENDER_DELAY_MS)

    // Display should be correct at the final size
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
    await expect(terminal.getByText("NORMAL")).toBeVisible()
  })
})
