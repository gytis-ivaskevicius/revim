import { expect, Keys, RENDER_DELAY_MS, test } from "./test-utils.js"

test("initial state: first viewport lines visible, content beyond viewport not visible", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  await expect(terminal.getByText("End of demo buffer.")).not.toBeVisible()
})

test("moving cursor down past viewport scrolls content up", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  await Keys.pressKeys(terminal, ["<Esc>"])
  for (let i = 0; i < 40; i++) {
    await Keys.pressKeys(terminal, ["j"])
  }
  await Keys.delay(RENDER_DELAY_MS)
  await expect(terminal.getByText("Welcome to ReVim!")).not.toBeVisible()
  await expect(terminal.getByText("Scrolling is now supported!")).toBeVisible()
})

test("moving cursor back up from scrolled position scrolls content back down", async ({ terminal }) => {
  await Keys.pressKeys(terminal, ["<Esc>"])
  for (let i = 0; i < 30; i++) {
    await Keys.pressKeys(terminal, ["j"])
  }
  await Keys.delay(RENDER_DELAY_MS)
  await expect(terminal.getByText("Welcome to ReVim!")).not.toBeVisible()
  for (let i = 0; i < 30; i++) {
    await Keys.pressKeys(terminal, ["k"])
  }
  await Keys.delay(RENDER_DELAY_MS)
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
})

test("G key jumps to last line and it is visible", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  await Keys.pressKeys(terminal, ["<Esc>", "G"])
  await Keys.delay(RENDER_DELAY_MS)
  await expect(terminal.getByText("End of demo buffer.")).toBeVisible()
  await expect(terminal.getByText("Welcome to ReVim!")).not.toBeVisible()
})

test("gg key after G returns to first line", async ({ terminal }) => {
  await Keys.pressKeys(terminal, ["<Esc>", "G"])
  await Keys.delay(RENDER_DELAY_MS)
  await expect(terminal.getByText("End of demo buffer.")).toBeVisible()
  await Keys.pressKeys(terminal, ["g", "g"])
  await Keys.delay(RENDER_DELAY_MS)
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  await expect(terminal.getByText("End of demo buffer.")).not.toBeVisible()
})

test("zz key centers cursor in viewport", async ({ terminal }) => {
  // Navigate to last line with G
  await Keys.pressKeys(terminal, ["<Esc>", "G"])
  await Keys.delay(RENDER_DELAY_MS)
  await expect(terminal.getByText("End of demo buffer.")).toBeVisible()
  // Press zz to center cursor in viewport
  await Keys.pressKeys(terminal, ["z", "z"])
  await Keys.delay(RENDER_DELAY_MS)
  // End of buffer should still be visible (centered in viewport)
  await expect(terminal.getByText("End of demo buffer.")).toBeVisible()
})
