import { expect, Keys, startRevim, test } from "./test-utils.js"

test.beforeEach(startRevim())

test(") moves forward across sentence boundaries", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  const before = terminal.getCursor()

  await Keys.pressKeys(terminal, [")", ")"])
  const afterSecond = terminal.getCursor()
  expect(afterSecond.y).toBe(before.y + 2)
})

test("( moves backward across sentence boundaries", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  await Keys.pressKeys(terminal, ["j", "j", "j"])

  const before = terminal.getCursor()

  await Keys.pressKeys(terminal, ["("])
  const after = terminal.getCursor()

  expect(after.y).toBe(before.y - 1)
})
