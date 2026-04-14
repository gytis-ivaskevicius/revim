import { expect, Keys, test } from "./test-utils.js"

test(") moves forward across sentence boundaries", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  const before = terminal.getCursor()

  terminal.keyPress(")")
  await Keys.delay()
  const afterFirst = terminal.getCursor()
  expect(afterFirst.y).toBe(before.y + 1)

  terminal.keyPress(")")
  await Keys.delay()
  const afterSecond = terminal.getCursor()
  expect(afterSecond.y).toBe(before.y + 2)
})

test("( moves backward across sentence boundaries", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  terminal.keyPress("j")
  await Keys.delay()
  terminal.keyPress("j")
  await Keys.delay()
  terminal.keyPress("j")
  await Keys.delay()

  const before = terminal.getCursor()

  terminal.keyPress("(")
  await Keys.delay()
  const after = terminal.getCursor()

  expect(after.y).toBe(before.y - 1)
})
