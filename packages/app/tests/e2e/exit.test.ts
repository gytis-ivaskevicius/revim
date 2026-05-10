import { expect, programConfig, test } from "./test-utils.js"

test.use(programConfig())

test("Ctrl+C exits cleanly", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible()
  const exitPromise = new Promise<void>((resolve) => {
    terminal.onExit(() => resolve())
  })
  terminal.keyCtrlC()
  await exitPromise
  expect(terminal.exitResult?.exitCode).toBe(0)
})

test("app stays running without Ctrl+C", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible()
  const before = terminal.getCursor()
  await new Promise((resolve) => setTimeout(resolve, 300))
  terminal.keyDown()
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(terminal.getCursor().y).toBe(before.y + 1)
  expect(terminal.exitResult).toBeNull()
})
