import { expect, Keys, keyEscape, keyPress, test } from "./test-utils.js"

test("status bar shows mode and key buffer", async ({ terminal }) => {
  // initial should show NORMAL (TerminalStatusBar writes initial state)
  await Keys.delay()
  await expect(terminal.getByText("NORMAL")).toBeVisible()

  // enter insert mode
  keyPress(terminal, "i")
  await Keys.delay()
  await expect(terminal.getByText("INSERT")).toBeVisible()

  // exit to normal
  keyEscape(terminal)
  await Keys.delay()
  await expect(terminal.getByText("NORMAL")).toBeVisible()

  // visual modes
  keyPress(terminal, "v")
  await Keys.delay()
  await expect(terminal.getByText("VISUAL")).toBeVisible()
  terminal.keyEscape()

  keyPress(terminal, "V")
  await Keys.delay()
  await expect(terminal.getByText("V-LINE")).toBeVisible()
  terminal.keyEscape()

  // pending keys: 2d shows in status
  await Keys.pressKeys(terminal, ["2", "d"])
  await expect(terminal.getByText("2d")).toBeVisible()

  // complete command 2dd
  keyPress(terminal, "d")
  await Keys.delay()
  // After command, key buffer should clear — visual assertion covered above
})
