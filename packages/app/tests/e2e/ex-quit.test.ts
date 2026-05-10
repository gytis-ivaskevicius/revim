import { expect, Keys, programConfig, test } from "./test-utils.js"

test.use(programConfig())

test(":q exits with code 0", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible()
  const exitPromise = new Promise<void>((resolve) => {
    terminal.onExit(() => resolve())
  })
  await Keys.pressKeys(terminal, [":", "q", "<Enter>"])
  await exitPromise
  expect(terminal.exitResult?.exitCode).toBe(0)
})

test(":q! also exits with code 0", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible()
  const exitPromise = new Promise<void>((resolve) => {
    terminal.onExit(() => resolve())
  })
  await Keys.pressKeys(terminal, [":", "q", "!", "<Enter>"])
  await exitPromise
  expect(terminal.exitResult?.exitCode).toBe(0)
})
