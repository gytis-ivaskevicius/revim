import { expect, Keys, RENDER_DELAY_MS, test } from "./test-utils.js"

test.describe("ex command prompt", () => {
  test("pressing : shows colon in status bar", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await Keys.pressKeys(terminal, [":"])
    await Keys.delay(RENDER_DELAY_MS)
    const statusText = terminal.getByText(":")
    await expect(statusText).toBeVisible()
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

  test("pressing Ctrl-C in : prompt closes the prompt and returns to NORMAL", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    await Keys.pressKeys(terminal, [":", { key: "c", ctrl: true }])
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
    // Prompt should still be visible with text
    const statusText = terminal.getByText(":! 1")
    await expect(statusText).toBeVisible()
  })

  test("pressing Down in : prompt navigates history without closing", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    // Execute two commands to populate history
    await Keys.pressKeys(terminal, [":", "!", " ", "1"])
    await Keys.pressKeys(terminal, ["<Enter>"])
    await Keys.delay(RENDER_DELAY_MS)
    await Keys.pressKeys(terminal, [":", "!", " ", "2"])
    await Keys.pressKeys(terminal, ["<Enter>"])
    await Keys.delay(RENDER_DELAY_MS)
    // Open prompt, press Up twice (to go to oldest), then Down (to go to newer)
    await Keys.pressKeys(terminal, [":", "<Up>", "<Up>", "<Down>"])
    await Keys.delay(RENDER_DELAY_MS)
    // After Up-Up-Down, we should be at ":! 1" (middle entry)
    const statusText = terminal.getByText(":! 1")
    await expect(statusText).toBeVisible()
  })
})
