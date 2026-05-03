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
})
