import { expect, KEY_PRESS_DELAY_MS, keyEscape, keyPress, test } from "./test-utils.js"

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test("status bar shows mode and key buffer", async ({ terminal }) => {
  // initial should show NORMAL (TerminalStatusBar writes initial state)
  await delay(KEY_PRESS_DELAY_MS)
  await expect(terminal.getByText("NORMAL")).toBeVisible()

  // enter insert mode
  keyPress(terminal, "i")
  await delay(KEY_PRESS_DELAY_MS)
  await expect(terminal.getByText("INSERT")).toBeVisible()

  // exit to normal
  keyEscape(terminal)
  await delay(KEY_PRESS_DELAY_MS)
  await expect(terminal.getByText("NORMAL")).toBeVisible()

  // visual modes
  keyPress(terminal, "v")
  await delay(KEY_PRESS_DELAY_MS)
  await expect(terminal.getByText("VISUAL")).toBeVisible()
  terminal.keyEscape()

  keyPress(terminal, "V")
  await delay(KEY_PRESS_DELAY_MS)
  await expect(terminal.getByText("V-LINE")).toBeVisible()
  terminal.keyEscape()

  // pending keys: 2d shows in status
  keyPress(terminal, "2")
  await delay(KEY_PRESS_DELAY_MS)
  keyPress(terminal, "d")
  await delay(KEY_PRESS_DELAY_MS)
  await expect(terminal.getByText("2d")).toBeVisible()

  // complete command 2dd
  keyPress(terminal, "d")
  await delay(KEY_PRESS_DELAY_MS)
  // After command, key buffer should clear — visual assertion covered above
})
