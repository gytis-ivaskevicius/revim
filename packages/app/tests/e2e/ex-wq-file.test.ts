import { randomUUID } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, Keys, programConfig, RENDER_DELAY_MS, test } from "./test-utils.js"

const tmpFile = path.join(tmpdir(), `revim-wq-${randomUUID()}.txt`)
writeFileSync(tmpFile, "original content\n")

test.use(programConfig([tmpFile]))
// Reset content after each run so retries get a clean slate.
test.afterEach(() => writeFileSync(tmpFile, "original content\n"))

test(":wq writes file and exits with code 0", async ({ terminal }) => {
  await expect(terminal.getByText("original content")).toBeVisible()

  const insertText = "modified "
  await Keys.pressKeys(terminal, ["i", ...insertText.split(""), "<Esc>"])
  await Keys.delay(RENDER_DELAY_MS)

  const exitPromise = new Promise<void>((resolve) => {
    terminal.onExit(() => resolve())
  })
  await Keys.pressKeys(terminal, [":", "w", "q", "<Enter>"])
  await exitPromise

  expect(terminal.exitResult?.exitCode).toBe(0)

  const content = readFileSync(tmpFile, "utf-8")
  expect(content).toContain("modified original content")
})
