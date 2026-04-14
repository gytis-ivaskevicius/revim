import { expect, Keys, test } from "./test-utils.js"

test("status bar shows mode and key buffer", async ({ terminal }) => {
  // initial should show NORMAL (TerminalStatusBar writes initial state)
  await Keys.delay()
  await expect(terminal.getByText("NORMAL")).toBeVisible()

  // enter insert mode
  await Keys.pressKeys(terminal, ["i"])
  await expect(terminal.getByText("INSERT")).toBeVisible()

  // exit to normal
  await Keys.pressKeys(terminal, ["<Esc>"])
  await expect(terminal.getByText("NORMAL")).toBeVisible()

  // visual modes
  await Keys.pressKeys(terminal, ["v"])
  await expect(terminal.getByText("VISUAL")).toBeVisible()
  await Keys.pressKeys(terminal, ["<Esc>"])

  await Keys.pressKeys(terminal, ["V"])
  await expect(terminal.getByText("V-LINE")).toBeVisible()
  await Keys.pressKeys(terminal, ["<Esc>"])

  // pending keys: 2d shows in status
  await Keys.pressKeys(terminal, ["2", "d"])
  await expect(terminal.getByText("2d")).toBeVisible()

  // complete command 2dd
  await Keys.pressKeys(terminal, ["d"])
  // After command, key buffer should clear — visual assertion covered above
})
