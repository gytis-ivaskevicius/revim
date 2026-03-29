import { expect, KEY_PRESS_DELAY_MS, test } from "./test-utils.js"

const delay = () => new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS))

test(") moves forward across sentence boundaries", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  const before = terminal.getCursor()

  terminal.keyPress(")")
  await delay()
  const afterFirst = terminal.getCursor()
  expect(afterFirst.y).toBe(before.y + 1)

  terminal.keyPress(")")
  await delay()
  const afterSecond = terminal.getCursor()
  expect(afterSecond.y).toBe(before.y + 2)
})

test("( moves backward across sentence boundaries", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  terminal.keyPress("j")
  await delay()
  terminal.keyPress("j")
  await delay()
  terminal.keyPress("j")
  await delay()

  const before = terminal.getCursor()

  terminal.keyPress("(")
  await delay()
  const after = terminal.getCursor()

  expect(after.y).toBe(before.y - 1)
})
