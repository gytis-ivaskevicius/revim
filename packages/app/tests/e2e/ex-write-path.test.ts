import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, Keys, programConfig, RENDER_DELAY_MS, test } from "./test-utils.js"

test.use(programConfig())

test(":w /tmp/file writes buffer content to a new file", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible()
  const tmpFile = path.join(tmpdir(), `revim-${randomUUID()}.txt`)

  const pathChars = tmpFile.split("")
  await Keys.pressKeys(terminal, [":", "w", " ", ...pathChars, "<Enter>"])
  await Keys.delay(RENDER_DELAY_MS * 2)

  expect(existsSync(tmpFile)).toBe(true)
  const content = readFileSync(tmpFile, "utf-8")
  expect(content.length).toBeGreaterThan(0)

  unlinkSync(tmpFile)
})

test(":wq /tmp/path writes to path and exits with code 0", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible()
  const tmpFile = path.join(tmpdir(), `revim-wq-path-${randomUUID()}.txt`)

  const exitPromise = new Promise<void>((resolve) => {
    terminal.onExit(() => resolve())
  })

  const pathChars = tmpFile.split("")
  await Keys.pressKeys(terminal, [":", "w", "q", " ", ...pathChars, "<Enter>"])
  await exitPromise

  expect(terminal.exitResult?.exitCode).toBe(0)
  expect(existsSync(tmpFile)).toBe(true)
  const content = readFileSync(tmpFile, "utf-8")
  expect(content.length).toBeGreaterThan(0)

  unlinkSync(tmpFile)
})
