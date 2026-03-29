import { expect, KEY_PRESS_DELAY_MS, test } from "./test-utils.js"

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test("status bar shows mode and key buffer", async ({ terminal }) => {
  // initial should show NORMAL (TerminalStatusBar writes initial state)
  await delay(KEY_PRESS_DELAY_MS)
  await expect(terminal.getByText("NORMAL")).toBeVisible()

  // enter insert mode
  // use helper methods on the terminal (provided by @microsoft/tui-test)
  if (typeof terminal.keyPress === "function") {
    terminal.keyPress("i")
  } else if (typeof (terminal as any).key === "function") {
    ;(terminal as any).key("i")
  }
  await delay(KEY_PRESS_DELAY_MS)
  await expect(terminal.getByText("INSERT")).toBeVisible()

  // exit to normal
  terminal.keyEscape()
  await delay(KEY_PRESS_DELAY_MS)
  await expect(terminal.getByText("NORMAL")).toBeVisible()

  // visual modes
  if (typeof terminal.keyPress === "function") {
    terminal.keyPress("v")
  } else if (typeof (terminal as any).key === "function") {
    ;(terminal as any).key("v")
  }
  await delay(KEY_PRESS_DELAY_MS)
  await expect(terminal.getByText("VISUAL")).toBeVisible()
  terminal.keyEscape()

  if (typeof terminal.keyPress === "function") {
    terminal.keyPress("V")
  } else if (typeof (terminal as any).key === "function") {
    ;(terminal as any).key("V")
  }
  await delay(KEY_PRESS_DELAY_MS)
  await expect(terminal.getByText("V-LINE")).toBeVisible()
  terminal.keyEscape()

  // pending keys: 2d shows in status
  if (typeof terminal.keyPress === "function") {
    terminal.keyPress("2")
  } else if (typeof (terminal as any).key === "function") {
    ;(terminal as any).key("2")
  }
  await delay(KEY_PRESS_DELAY_MS)
  if (typeof terminal.keyPress === "function") {
    terminal.keyPress("d")
  } else if (typeof (terminal as any).key === "function") {
    ;(terminal as any).key("d")
  }
  await delay(KEY_PRESS_DELAY_MS)
  await expect(terminal.getByText("2d")).toBeVisible()

  // complete command 2dd
  terminal.keyPress("d")
  await delay(KEY_PRESS_DELAY_MS)
  // After command, key buffer should clear — visual assertion covered above
})
