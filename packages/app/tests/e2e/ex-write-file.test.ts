import { randomUUID } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, Keys, programConfig, RENDER_DELAY_MS, test } from "./test-utils.js"

const tmpFile = path.join(tmpdir(), `revim-write-${randomUUID()}.txt`)
writeFileSync(tmpFile, "original line one\nline two\n")

test.use(programConfig([tmpFile]))
// Reset content after each run so retries get a clean slate.
test.afterEach(() => writeFileSync(tmpFile, "original line one\nline two\n"))

test(":w writes buffer modifications to the loaded file", async ({ terminal }) => {
  await expect(terminal.getByText("original line one")).toBeVisible()

  const insertText = "modified "
  await Keys.pressKeys(terminal, ["i", ...insertText.split(""), "<Esc>"])
  await Keys.delay(RENDER_DELAY_MS)

  await Keys.pressKeys(terminal, [":", "w", "<Enter>"])
  await Keys.delay(RENDER_DELAY_MS * 2)

  const content = readFileSync(tmpFile, "utf-8")
  expect(content).toContain("modified original line one")
})
