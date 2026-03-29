import { expect, KEY_PRESS_DELAY_MS, test } from "./test-utils.js"

const delay = () => new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS))

const visibleBuffer = (terminal: { getViewableBuffer: () => string[][] }) =>
  terminal
    .getViewableBuffer()
    .map((row) => row.join(""))
    .join("\n")

async function pressKeys(
  terminal: {
    keyPress: (key: string) => void
    keyEscape: () => void
  },
  keys: string[],
) {
  for (const key of keys) {
    if (key === "<Esc>") {
      terminal.keyEscape()
    } else {
      terminal.keyPress(key)
    }
    await delay()
  }
}

test("undo at empty history does not change buffer", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const bufferBefore = visibleBuffer(terminal)
  await pressKeys(terminal, ["u"])
  const bufferAfter = visibleBuffer(terminal)

  if (bufferBefore !== bufferAfter) {
    throw new Error(`Expected buffer to remain unchanged, got: ${bufferAfter}`)
  }
})
