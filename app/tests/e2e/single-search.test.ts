import { expect, keyPress, RENDER_DELAY_MS, test, withLog } from "./test-utils.js"

const LOG = "/tmp/revim-single-test.log"

test.describe("search single test", () => {
  test.use(withLog(LOG))

  test("l works after search", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

    // Get cursor before search
    const cursorBefore = terminal.getCursor()
    console.log("Cursor before search:", cursorBefore)

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

    // Press 'l' to move right
    keyPress(terminal, "l")
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS * 2))

    // Get cursor after l
    const cursorAfterL = terminal.getCursor()
    console.log("Cursor after l:", cursorAfterL)

    // The cursor should have moved after pressing l
    expect(cursorAfterL.x).toBe(cursorAfterSearch.x + 1)
  })
})
