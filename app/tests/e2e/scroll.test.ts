import { expect, Keys, RENDER_DELAY_MS, test } from "./test-utils.js"

test("initial state: first viewport lines visible, content beyond viewport not visible", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  await expect(terminal.getByText("End of demo buffer.")).not.toBeVisible()
})

test("moving cursor down past viewport scrolls content up", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  for (let i = 0; i < 40; i++) {
    terminal.keyDown()
    await Keys.delay()
  }
  await Keys.delay(RENDER_DELAY_MS)
  await expect(terminal.getByText("Welcome to ReVim!")).not.toBeVisible()
  await expect(terminal.getByText("Scrolling is now supported!")).toBeVisible()
})

test("moving cursor back up from scrolled position scrolls content back down", async ({ terminal }) => {
  for (let i = 0; i < 30; i++) {
    terminal.keyDown()
    await Keys.delay()
  }
  await Keys.delay(RENDER_DELAY_MS)
  await expect(terminal.getByText("Welcome to ReVim!")).not.toBeVisible()
  for (let i = 0; i < 30; i++) {
    terminal.keyUp()
    await Keys.delay()
  }
  await Keys.delay(RENDER_DELAY_MS)
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
})

test("G key jumps to last line and it is visible", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  terminal.keyEscape()
  await Keys.delay(RENDER_DELAY_MS)
  terminal.keyPress("G")
  await Keys.delay(RENDER_DELAY_MS)
  await expect(terminal.getByText("End of demo buffer.")).toBeVisible()
  await expect(terminal.getByText("Welcome to ReVim!")).not.toBeVisible()
})

test("gg key after G returns to first line", async ({ terminal }) => {
  terminal.keyEscape()
  await Keys.delay(RENDER_DELAY_MS)
  terminal.keyPress("G")
  await Keys.delay(RENDER_DELAY_MS)
  await expect(terminal.getByText("End of demo buffer.")).toBeVisible()
  terminal.keyPress("g")
  await Keys.delay(RENDER_DELAY_MS)
  terminal.keyPress("g")
  await Keys.delay(RENDER_DELAY_MS)
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  await expect(terminal.getByText("End of demo buffer.")).not.toBeVisible()
})

test("zz key centers cursor in viewport", async ({ terminal }) => {
  // Navigate to last line with G
  terminal.keyEscape()
  await Keys.delay(RENDER_DELAY_MS)
  terminal.keyPress("G")
  await Keys.delay(RENDER_DELAY_MS)
  await expect(terminal.getByText("End of demo buffer.")).toBeVisible()
  // Press zz to center cursor in viewport
  terminal.keyPress("z")
  await Keys.delay(RENDER_DELAY_MS)
  terminal.keyPress("z")
  await Keys.delay(RENDER_DELAY_MS)
  // End of buffer should still be visible (centered in viewport)
  await expect(terminal.getByText("End of demo buffer.")).toBeVisible()
})
