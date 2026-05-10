import { expect, Keys, RENDER_DELAY_MS, startRevim, test } from "./test-utils.js"

test.describe("ex command prompt", () => {
  test.beforeEach(startRevim())
  test("pressing : opens ex command prompt and accepts input", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await Keys.pressKeys(terminal, [":"])
    await Keys.delay(RENDER_DELAY_MS)
    // Type a character to verify prompt is open and accepts input
    await Keys.pressKeys(terminal, ["a"])
    await Keys.delay(RENDER_DELAY_MS)
    await expect(terminal.getByText(":a")).toBeVisible()
  })

  test("typing :hello shows :hello in status bar", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await Keys.pressKeys(terminal, [":", "h", "e", "l", "l", "o"])
    await Keys.delay(RENDER_DELAY_MS)
    const statusText = terminal.getByText(":hello")
    await expect(statusText).toBeVisible()
  })

  test("pressing Esc in : prompt closes the prompt and returns to NORMAL", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await Keys.pressKeys(terminal, [":", "<Esc>"])
    await Keys.delay(RENDER_DELAY_MS)
    const normalLabel = terminal.getByText("NORMAL")
    await expect(normalLabel).toBeVisible()
  })

  test("pressing Up in : prompt navigates history without closing", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    // First execute an ex command to populate history
    await Keys.pressKeys(terminal, [":", "!", " ", "1"])
    await Keys.pressKeys(terminal, ["<Enter>"])
    await Keys.delay(RENDER_DELAY_MS)
    // Open : prompt again and press Up to recall previous command
    await Keys.pressKeys(terminal, [":", "<Up>"])
    await Keys.delay(RENDER_DELAY_MS)
    // Prompt should still be visible with the recalled text from history
    // Status bar should show the recalled command from history
    const statusText = terminal.getByText(":! 1")
    await expect(statusText).toBeVisible()
  })

  test("pressing Down in : prompt with empty history stays open", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    // Open prompt, type something, press Down (should not crash, should stay open with text)
    await Keys.pressKeys(terminal, [":", "h", "i", "<Down>"])
    await Keys.delay(RENDER_DELAY_MS)
    // Prompt should still be visible (not closed)
    const statusText = terminal.getByText(":hi")
    await expect(statusText).toBeVisible()
  })
})
