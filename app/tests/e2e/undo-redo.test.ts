import { expect, KEY_PRESS_DELAY_MS, test } from "./test-utils.js"

const delay = () => new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS))

const visibleBuffer = (terminal: { getViewableBuffer: () => string[][] }) =>
  terminal
    .getViewableBuffer()
    .map((row) => row.join(""))
    .join("\n")

async function pressKeys(
  terminal: {
    keyPress: (key: string, options?: { ctrl?: boolean; alt?: boolean; shift?: boolean }) => void
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
  const cursorBefore = terminal.getCursor()

  await pressKeys(terminal, ["i", "H", "e", "l", "l", "o", "<Esc>"])

  const buffer1 = visibleBuffer(terminal)
  expect(buffer1.includes("Hello")).toBe(true)

  await pressKeys(terminal, ["u"])

  const buffer2 = visibleBuffer(terminal)
  expect(buffer2.includes("Welcome to ReVim!")).toBe(true)
  expect(terminal.getCursor().y).toBe(cursorBefore.y)
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

  await pressKeys(terminal, ["i", "A", "A", "<Esc>"])
  await pressKeys(terminal, ["i", "B", "B", "<Esc>"])
  await pressKeys(terminal, ["i", "C", "C", "<Esc>"])

  const buffer1 = visibleBuffer(terminal)
  expect(buffer1.includes("CC")).toBe(true)

  await pressKeys(terminal, ["u"])
  const buffer2 = visibleBuffer(terminal)
  expect(buffer2.includes("BB")).toBe(true)

  await pressKeys(terminal, ["u"])
  const buffer3 = visibleBuffer(terminal)
  expect(buffer3.includes("AA")).toBe(true)
})

test("U undoes all changes on current line", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const cursorBefore = terminal.getCursor()
  await pressKeys(terminal, ["i", "H", "e", "l", "l", "o", "<Esc>", "U"])

  const buffer = visibleBuffer(terminal)
  expect(buffer.includes("Welcome to ReVim!")).toBe(true)
  expect(terminal.getCursor().y).toBe(cursorBefore.y)
})

test("no changes on current line then U pressed does nothing", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const bufferBefore = visibleBuffer(terminal)
  await pressKeys(terminal, ["U"])
  const bufferAfter = visibleBuffer(terminal)
  expect(bufferBefore).toBe(bufferAfter)
})

async function pressCtrlR(terminal: { keyPress: (key: string, options?: { ctrl?: boolean }) => void }) {
  terminal.keyPress("r", { ctrl: true })
  await delay()
}

test("redo restores text after undo", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  await pressKeys(terminal, ["i", "H", "e", "l", "l", "o", "<Esc>"])

  const buffer1 = visibleBuffer(terminal)
  expect(buffer1.includes("Hello")).toBe(true)

  await pressKeys(terminal, ["u"])

  const buffer2 = visibleBuffer(terminal)
  expect(buffer2.includes("Welcome to ReVim!")).toBe(true)

  await pressCtrlR(terminal)

  const buffer3 = visibleBuffer(terminal)
  expect(buffer3.includes("Hello")).toBe(true)
})

test("multiple redos restore multiple edit groups", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  await pressKeys(terminal, ["i", "X", "X", "<Esc>"])
  await pressKeys(terminal, ["i", "Y", "Y", "<Esc>"])
  await pressKeys(terminal, ["i", "Z", "Z", "<Esc>"])

  await pressKeys(terminal, ["u"])
  await pressKeys(terminal, ["u"])

  const buffer1 = visibleBuffer(terminal)
  expect(buffer1.includes("XX")).toBe(true)

  await pressCtrlR(terminal)
  const buffer2 = visibleBuffer(terminal)
  expect(buffer2.includes("YY")).toBe(true)

  await pressCtrlR(terminal)
  const buffer3 = visibleBuffer(terminal)
  expect(buffer3.includes("ZZ")).toBe(true)
})

test("redo at empty history does not change buffer", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const bufferBefore = visibleBuffer(terminal)
  await pressCtrlR(terminal)
  const bufferAfter = visibleBuffer(terminal)
  expect(bufferBefore).toBe(bufferAfter)
})

test("new edit after undo clears redo stack", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  await pressKeys(terminal, ["i", "H", "e", "l", "l", "o", "<Esc>"])

  const bufferWithHello = visibleBuffer(terminal)
  expect(bufferWithHello.includes("Hello")).toBe(true)

  await pressKeys(terminal, ["u"])

  const bufferAfterUndo = visibleBuffer(terminal)
  expect(bufferAfterUndo.includes("Hello")).toBe(false)
  expect(bufferAfterUndo.includes("Welcome to ReVim!")).toBe(true)

  await pressKeys(terminal, ["i", "W", "o", "r", "l", "d", "<Esc>"])

  const bufferWithWorld = visibleBuffer(terminal)
  expect(bufferWithWorld.includes("World")).toBe(true)

  await pressCtrlR(terminal)

  const buffer = visibleBuffer(terminal)
  expect(buffer.includes("World")).toBe(true)
  expect(buffer.includes("Hello")).toBe(false)
})

test("dd then u restores deleted line", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  await pressKeys(terminal, ["d", "d"])

  const bufferAfterDd = visibleBuffer(terminal)
  expect(bufferAfterDd.includes("Welcome to ReVim!")).toBe(false)

  await pressKeys(terminal, ["u"])

  const bufferAfterUndo = visibleBuffer(terminal)
  expect(bufferAfterUndo.includes("Welcome to ReVim!")).toBe(true)
})
