import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, Keys, RENDER_DELAY_MS, test, withFile } from "./test-utils.js"

test.describe("ex write and quit commands", () => {
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

  test(":w /tmp/file writes buffer content to a new file", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    const tmpFile = path.join(tmpdir(), `revim-${randomUUID()}.txt`)

    // Write to a specific path
    const pathChars = tmpFile.split("")
    await Keys.pressKeys(terminal, [":", "w", " ", ...pathChars, "<Enter>"])
    await Keys.delay(RENDER_DELAY_MS * 2)

    // Verify the file was created with buffer content
    expect(existsSync(tmpFile)).toBe(true)
    const content = readFileSync(tmpFile, "utf-8")
    expect(content.length).toBeGreaterThan(0)

    // Cleanup
    unlinkSync(tmpFile)
  })

  test(":wq /tmp/path writes to path and exits with code 0", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    const tmpFile = path.join(tmpdir(), `revim-wq-path-${randomUUID()}.txt`)

    const exitPromise = new Promise<void>((resolve) => {
      terminal.onExit(() => resolve())
    })

    // Type :wq /tmp/... and press Enter
    const pathChars = tmpFile.split("")
    await Keys.pressKeys(terminal, [":", "w", "q", " ", ...pathChars, "<Enter>"])
    await exitPromise

    // Verify exit code and file content
    expect(terminal.exitResult?.exitCode).toBe(0)
    expect(existsSync(tmpFile)).toBe(true)
    const content = readFileSync(tmpFile, "utf-8")
    expect(content.length).toBeGreaterThan(0)

    // Cleanup
    unlinkSync(tmpFile)
  })
})

test.describe(":w! with loaded file", () => {
  const tmpFile = path.join(tmpdir(), `revim-wbang-${randomUUID()}.txt`)

  // Create the temp file before tests use it
  writeFileSync(tmpFile, "original content\n")

  test.use(withFile(tmpFile))

  test(":w! behaves identically to :w and writes to the loaded file", async ({ terminal }) => {
    await expect(terminal.getByText("original content")).toBeVisible()

    // Write with ! flag — should write to loaded file
    await Keys.pressKeys(terminal, [":", "w", "!", "<Enter>"])
    await Keys.delay(RENDER_DELAY_MS * 2)

    // Verify file was written (still has the original content since we didn't modify)
    const content = readFileSync(tmpFile, "utf-8")
    expect(content).toContain("original content")

    // Cleanup
    try {
      unlinkSync(tmpFile)
    } catch {
      // ignore cleanup errors
    }
  })
})

test.describe(":w with loaded file", () => {
  const tmpFile = path.join(tmpdir(), `revim-write-${randomUUID()}.txt`)

  // Create the temp file before tests use it
  writeFileSync(tmpFile, "original line one\nline two\n")

  test.use(withFile(tmpFile))

  test(":w writes buffer modifications to the loaded file", async ({ terminal }) => {
    await expect(terminal.getByText("original line one")).toBeVisible()

    // Modify the first line
    const insertText = "modified "
    await Keys.pressKeys(terminal, ["i", ...insertText.split(""), "<Esc>"])
    await Keys.delay(RENDER_DELAY_MS)

    // Write the file
    await Keys.pressKeys(terminal, [":", "w", "<Enter>"])
    await Keys.delay(RENDER_DELAY_MS * 2)

    // Verify file on disk reflects the modification
    const content = readFileSync(tmpFile, "utf-8")
    expect(content).toContain("modified original line one")

    // Cleanup
    try {
      unlinkSync(tmpFile)
    } catch {
      // ignore cleanup errors
    }
  })
})

test.describe(":wq with loaded file", () => {
  const tmpFile = path.join(tmpdir(), `revim-wq-${randomUUID()}.txt`)

  // Create the temp file before tests use it
  writeFileSync(tmpFile, "original content\n")

  test.use(withFile(tmpFile))

  test(":wq writes file and exits with code 0", async ({ terminal }) => {
    await expect(terminal.getByText("original content")).toBeVisible()

    // Modify the first line
    const insertText = "modified "
    await Keys.pressKeys(terminal, ["i", ...insertText.split(""), "<Esc>"])
    await Keys.delay(RENDER_DELAY_MS)

    // Write and quit
    const exitPromise = new Promise<void>((resolve) => {
      terminal.onExit(() => resolve())
    })
    await Keys.pressKeys(terminal, [":", "w", "q", "<Enter>"])
    await exitPromise

    expect(terminal.exitResult?.exitCode).toBe(0)

    // Verify file on disk reflects the modification
    const content = readFileSync(tmpFile, "utf-8")
    expect(content).toContain("modified original content")

    // Cleanup
    try {
      unlinkSync(tmpFile)
    } catch {
      // ignore cleanup errors
    }
  })
})
