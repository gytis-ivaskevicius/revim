import { expect, Keys, test } from "./test-utils.js"

test("insert text then undo reverts to original", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const cursorBefore = terminal.getCursor()

  await Keys.pressKeys(terminal, ["i", "H", "e", "l", "l", "o", "<Esc>"])

  const buffer1 = Keys.visibleBuffer(terminal)
  expect(buffer1.includes("Hello")).toBe(true)

  await Keys.pressKeys(terminal, ["u"])

  const buffer2 = Keys.visibleBuffer(terminal)
  expect(buffer2.includes("Welcome to ReVim!")).toBe(true)
  expect(terminal.getCursor().y).toBe(cursorBefore.y)
})

test("undo at empty history does not change buffer", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const bufferBefore = Keys.visibleBuffer(terminal)
  await Keys.pressKeys(terminal, ["u"])
  const bufferAfter = Keys.visibleBuffer(terminal)
  expect(bufferBefore).toBe(bufferAfter)
})

test("multiple undos revert multiple edit groups", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  await Keys.pressKeys(terminal, ["i", "A", "A", "<Esc>"])
  await Keys.pressKeys(terminal, ["i", "B", "B", "<Esc>"])
  await Keys.pressKeys(terminal, ["i", "C", "C", "<Esc>"])

  const buffer1 = Keys.visibleBuffer(terminal)
  expect(buffer1.includes("CC")).toBe(true)

  await Keys.pressKeys(terminal, ["u"])
  const buffer2 = Keys.visibleBuffer(terminal)
  expect(buffer2.includes("BB")).toBe(true)

  await Keys.pressKeys(terminal, ["u"])
  const buffer3 = Keys.visibleBuffer(terminal)
  expect(buffer3.includes("AA")).toBe(true)
})

test("U undoes all changes on current line", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const cursorBefore = terminal.getCursor()
  await Keys.pressKeys(terminal, ["i", "H", "e", "l", "l", "o", "<Esc>", "U"])

  const buffer = Keys.visibleBuffer(terminal)
  expect(buffer.includes("Welcome to ReVim!")).toBe(true)
  expect(terminal.getCursor().y).toBe(cursorBefore.y)
})

test("no changes on current line then U pressed does nothing", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const bufferBefore = Keys.visibleBuffer(terminal)
  await Keys.pressKeys(terminal, ["U"])
  const bufferAfter = Keys.visibleBuffer(terminal)
  expect(bufferBefore).toBe(bufferAfter)
})

async function pressCtrlR(terminal: { keyPress: (key: string, options?: { ctrl?: boolean }) => void }) {
  terminal.keyPress("r", { ctrl: true })
  await Keys.delay()
}

test("redo restores text after undo", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  await Keys.pressKeys(terminal, ["i", "H", "e", "l", "l", "o", "<Esc>"])

  const buffer1 = Keys.visibleBuffer(terminal)
  expect(buffer1.includes("Hello")).toBe(true)

  await Keys.pressKeys(terminal, ["u"])

  const buffer2 = Keys.visibleBuffer(terminal)
  expect(buffer2.includes("Welcome to ReVim!")).toBe(true)

  await pressCtrlR(terminal)

  const buffer3 = Keys.visibleBuffer(terminal)
  expect(buffer3.includes("Hello")).toBe(true)
})

test("multiple redos restore multiple edit groups", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  await Keys.pressKeys(terminal, ["i", "X", "X", "<Esc>"])
  await Keys.pressKeys(terminal, ["i", "Y", "Y", "<Esc>"])
  await Keys.pressKeys(terminal, ["i", "Z", "Z", "<Esc>"])

  await Keys.pressKeys(terminal, ["u"])
  await Keys.pressKeys(terminal, ["u"])

  const buffer1 = Keys.visibleBuffer(terminal)
  expect(buffer1.includes("XX")).toBe(true)

  await pressCtrlR(terminal)
  const buffer2 = Keys.visibleBuffer(terminal)
  expect(buffer2.includes("YY")).toBe(true)

  await pressCtrlR(terminal)
  const buffer3 = Keys.visibleBuffer(terminal)
  expect(buffer3.includes("ZZ")).toBe(true)
})

test("redo at empty history does not change buffer", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const bufferBefore = Keys.visibleBuffer(terminal)
  await pressCtrlR(terminal)
  const bufferAfter = Keys.visibleBuffer(terminal)
  expect(bufferBefore).toBe(bufferAfter)
})

test("new edit after undo clears redo stack", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  await Keys.pressKeys(terminal, ["i", "H", "e", "l", "l", "o", "<Esc>"])

  const bufferWithHello = Keys.visibleBuffer(terminal)
  expect(bufferWithHello.includes("Hello")).toBe(true)

  await Keys.pressKeys(terminal, ["u"])

  const bufferAfterUndo = Keys.visibleBuffer(terminal)
  expect(bufferAfterUndo.includes("Hello")).toBe(false)
  expect(bufferAfterUndo.includes("Welcome to ReVim!")).toBe(true)

  await Keys.pressKeys(terminal, ["i", "W", "o", "r", "l", "d", "<Esc>"])

  const bufferWithWorld = Keys.visibleBuffer(terminal)
  expect(bufferWithWorld.includes("World")).toBe(true)

  await pressCtrlR(terminal)

  const buffer = Keys.visibleBuffer(terminal)
  expect(buffer.includes("World")).toBe(true)
  expect(buffer.includes("Hello")).toBe(false)
})

test("dd then u restores deleted line", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  await Keys.pressKeys(terminal, ["d", "d"])

  const bufferAfterDd = Keys.visibleBuffer(terminal)
  expect(bufferAfterDd.includes("Welcome to ReVim!")).toBe(false)

  await Keys.pressKeys(terminal, ["u"])

  const bufferAfterUndo = Keys.visibleBuffer(terminal)
  expect(bufferAfterUndo.includes("Welcome to ReVim!")).toBe(true)
})

test("r<char> replaces character and u undoes it", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const initialCursor = terminal.getCursor()

  await Keys.pressKeys(terminal, ["r", "Z"])

  const bufferAfterReplace = Keys.visibleBuffer(terminal)
  expect(bufferAfterReplace.includes("Zelcome to ReVim!")).toBe(true)

  await Keys.pressKeys(terminal, ["u"])

  const bufferAfterUndo = Keys.visibleBuffer(terminal)
  expect(bufferAfterUndo.includes("Welcome to ReVim!")).toBe(true)
  expect(terminal.getCursor().x).toBe(initialCursor.x)
})

test("r<char> then u then Ctrl+r redoes the replace", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  await Keys.pressKeys(terminal, ["r", "Z"])

  await Keys.pressKeys(terminal, ["u"])

  const bufferAfterUndo = Keys.visibleBuffer(terminal)
  expect(bufferAfterUndo.includes("Welcome to ReVim!")).toBe(true)

  await pressCtrlR(terminal)

  const bufferAfterRedo = Keys.visibleBuffer(terminal)
  expect(bufferAfterRedo.includes("Zelcome to ReVim!")).toBe(true)
})

test("r<char> then u then new edit clears redo stack", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  await Keys.pressKeys(terminal, ["r", "Z"])

  await Keys.pressKeys(terminal, ["u"])

  await Keys.pressKeys(terminal, ["i", "X", "<Esc>"])

  await pressCtrlR(terminal)

  const buffer = Keys.visibleBuffer(terminal)
  expect(buffer.includes("X")).toBe(true)
  expect(buffer.includes("Zelcome")).toBe(false)
})

test("r<Enter> splits line and u restores it", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  await Keys.pressKeys(terminal, ["r", "Enter"])

  const bufferAfterSplit = Keys.visibleBuffer(terminal)
  expect(bufferAfterSplit.includes("elcome to ReVim!")).toBe(true)

  await Keys.pressKeys(terminal, ["u"])

  const bufferAfterUndo = Keys.visibleBuffer(terminal)
  expect(bufferAfterUndo.includes("Welcome to ReVim!")).toBe(true)
})

test("empty undo history then r<char> then u reverts the replace", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  await Keys.pressKeys(terminal, ["u"])

  await Keys.pressKeys(terminal, ["r", "Z"])

  await Keys.pressKeys(terminal, ["u"])

  const buffer = Keys.visibleBuffer(terminal)
  expect(buffer.includes("Welcome to ReVim!")).toBe(true)
})
