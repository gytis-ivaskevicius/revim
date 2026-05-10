import { expect, Keys, startRevim, test } from "./test-utils.js"

test.beforeEach(startRevim())

test("Ctrl+C exits insert mode", async ({ terminal }) => {
  await expect(terminal.getByText("NORMAL")).toBeVisible()

  await Keys.pressKeys(terminal, ["i"])
  await expect(terminal.getByText("INSERT")).toBeVisible()

  terminal.keyCtrlC()
  await Keys.delay(50)

  await expect(terminal.getByText("NORMAL")).toBeVisible()
})

test("Ctrl+C exits visual mode", async ({ terminal }) => {
  await expect(terminal.getByText("NORMAL")).toBeVisible()

  await Keys.pressKeys(terminal, [{ key: "V", shift: true }])
  await expect(terminal.getByText("V-LINE")).toBeVisible()

  terminal.keyCtrlC()
  await Keys.delay(50)

  await expect(terminal.getByText("NORMAL")).toBeVisible()
})
