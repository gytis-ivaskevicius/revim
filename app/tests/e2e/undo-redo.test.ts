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
  expect(buffer1.includes("Hello")).toBe(true)

  await pressKeys(terminal, ["u"])

  const buffer2 = visibleBuffer(terminal)
  expect(buffer2.includes("Welcome to ReVim!")).toBe(true)
})

test("undo at empty history does not change buffer", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const bufferBefore = visibleBuffer(terminal)
  await pressKeys(terminal, ["u"])
  const bufferAfter = visibleBuffer(terminal)
  expect(bufferBefore).toBe(bufferAfter)
})

test("multiple undos revert multiple edit groups", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  await pressKeys(terminal, ["i", "a", "<Esc>"])
  await pressKeys(terminal, ["i", "b", "<Esc>"])
  await pressKeys(terminal, ["i", "c", "<Esc>"])

  const buffer1 = visibleBuffer(terminal)
  expect(buffer1.includes("c")).toBe(true)

  await pressKeys(terminal, ["u"])
  const buffer2 = visibleBuffer(terminal)
  expect(buffer2.includes("b")).toBe(true)

  await pressKeys(terminal, ["u"])
  const buffer3 = visibleBuffer(terminal)
  expect(buffer3.includes("a")).toBe(true)
})
