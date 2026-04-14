import { expect, keyPress, RENDER_DELAY_MS, test, withLog } from "./test-utils.js"
import { readFileSync, writeFileSync } from "node:fs"

const LOG = "/tmp/revim-search-debug.log"
const DEBUG_OUTPUT = "/tmp/revim-debug-output.txt"

test.describe("search debug", () => {
  test.use(withLog(LOG))

  test("verify j moves cursor after search", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

    // Get initial cursor position
    const cursorBefore = terminal.getCursor()
    console.log("Cursor before:", cursorBefore)

    // Type search for "movement"
    keyPress(terminal, "/")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))

    for (const ch of "movement") {
      keyPress(terminal, ch)
      await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    }

    keyPress(terminal, "Enter")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS * 3))

    // Check that NORMAL mode label is visible
    await expect(terminal.getByText("NORMAL")).toBeVisible()

    // Get cursor after search
    const cursorAfterSearch = terminal.getCursor()
    console.log("Cursor after search:", cursorAfterSearch)

    // Press 'j' to move down
    keyPress(terminal, "j")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS * 2))

    // Get cursor after j
    const cursorAfterJ = terminal.getCursor()
    console.log("Cursor after j:", cursorAfterJ)

    // Read log
    const logContent = readFileSync(LOG, "utf-8")

    // Extract key-related log lines
    const keyLines = logContent.split("\n").filter((line) => line.includes("key:") || line.includes("motionFindNext"))

    let debug = "Key log entries:\n"
    keyLines.forEach((line) => {
      debug += line + "\n"
    })
    debug += "\nCursors:\n"
    debug += `Before: ${JSON.stringify(cursorBefore)}\n`
    debug += `After search: ${JSON.stringify(cursorAfterSearch)}\n`
    debug += `After j: ${JSON.stringify(cursorAfterJ)}\n`

    writeFileSync(DEBUG_OUTPUT, debug)
    console.log("Debug written to:", DEBUG_OUTPUT)

    // The cursor should have moved after pressing j
    expect(cursorAfterJ.y).toBe(cursorAfterSearch.y + 1)
  })
})
