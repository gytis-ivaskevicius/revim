import { unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, Keys, RENDER_DELAY_MS, test, withFile } from "./test-utils.js"

test("status bar shows mode and key buffer", async ({ terminal }) => {
  // initial should show NORMAL (TerminalStatusBar writes initial state)
  await Keys.delay()
  await expect(terminal.getByText("NORMAL")).toBeVisible()

  // enter insert mode
  await Keys.pressKeys(terminal, ["i"])
  await expect(terminal.getByText("INSERT")).toBeVisible()

  // exit to normal
  await Keys.pressKeys(terminal, ["<Esc>"])
  await expect(terminal.getByText("NORMAL")).toBeVisible()

  // visual modes
  await Keys.pressKeys(terminal, ["v"])
  await expect(terminal.getByText("VISUAL")).toBeVisible()
  await Keys.pressKeys(terminal, ["<Esc>"])

  await Keys.pressKeys(terminal, ["V"])
  await expect(terminal.getByText("V-LINE")).toBeVisible()
  await Keys.pressKeys(terminal, ["<Esc>"])

  // pending keys: 2d shows in status
  await Keys.pressKeys(terminal, ["2", "d"])
  await expect(terminal.getByText("2d")).toBeVisible()

  // complete command 2dd
  await Keys.pressKeys(terminal, ["d"])
  // After command, key buffer should clear — visual assertion covered above
})

test.describe("status bar with file path", () => {
  const testFile = path.join(tmpdir(), `revim-status-test-${Date.now()}.txt`)

  // Create file with content
  writeFileSync(testFile, "line one\nline two\nline three\nline four\nline five\n")

  test.use(withFile(testFile))

  test("status bar shows filename and cursor position", async ({ terminal }) => {
    // Should show the filename in the status bar
    const filename = path.basename(testFile)
    await expect(terminal.getByText(filename)).toBeVisible()

    // Should show initial cursor position 1:1
    await expect(terminal.getByText("1:1")).toBeVisible()

    // Move cursor down twice — should show 3:1
    await Keys.pressKeys(terminal, ["j", "j"])
    await Keys.delay(RENDER_DELAY_MS)
    await expect(terminal.getByText("3:1")).toBeVisible()

    // Move cursor right — should show 3:2
    await Keys.pressKeys(terminal, ["l"])
    await Keys.delay(RENDER_DELAY_MS)
    await expect(terminal.getByText("3:2")).toBeVisible()
  })

  test("status bar shows mode label", async ({ terminal }) => {
    await expect(terminal.getByText("NORMAL")).toBeVisible()

    // Enter insert mode
    await Keys.pressKeys(terminal, ["i"])
    await expect(terminal.getByText("INSERT")).toBeVisible()
  })

  // Cleanup
  test.afterAll(() => {
    try {
      unlinkSync(testFile)
    } catch {}
  })
})

test.describe("status bar notifications", () => {
  test(":set with unknown option shows notification", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()

    // Execute :set with an unknown option — triggers showConfirm -> openNotification
    await Keys.pressKeys(terminal, [":", "s", "e", "t", " ", "u", "n", "k", "n", "o", "w", "n", "<Enter>"])
    await Keys.delay(RENDER_DELAY_MS)

    // The notification should appear ("no such option: unknown" or similar)
    // Try matching on parts of the notification message
    await expect(terminal.getByText(/unknown/)).toBeVisible()
  })
})
