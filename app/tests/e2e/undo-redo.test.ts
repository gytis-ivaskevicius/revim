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

test("insert text then undo reverts to original", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  await pressKeys(terminal, ["i", "H", "e", "l", "l", "o", "<Esc>"])

  const buffer1 = visibleBuffer(terminal)
  console.log("After insert:", buffer1)

  await pressKeys(terminal, ["u"])

  const buffer2 = visibleBuffer(terminal)
  console.log("After undo:", buffer2)

  if (!buffer2.includes("Welcome to ReVim!")) {
    throw new Error(`Expected buffer to include 'Welcome to ReVim!', got: ${buffer2}`)
  }
})
