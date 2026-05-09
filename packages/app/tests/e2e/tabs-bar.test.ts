import { expect, Keys, test, withFile, withFiles } from "./test-utils.js"

const DEMO_FIXTURE = "packages/app/tests/fixtures/demo-content.md"
const BUFFER2_FIXTURE = "packages/app/tests/fixtures/buffer2-content.md"

test.describe("tabs bar", () => {
  test.describe("single buffer mode", () => {
    test.use(withFile(DEMO_FIXTURE))

    test("single buffer does NOT show the tabs bar", async ({ terminal }) => {
      // With a single file opened via CLI, the tabs bar should not appear
      await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

      // Check the visible buffer does not contain any tab patterns
      const buffer = Keys.visibleBuffer(terminal)
      expect(buffer).not.toContain(" 1 ")
    })
  })

  test.describe("default dev mode (2 demo buffers)", () => {
    // Default config (no CLI args) opens 2 demo buffers

    test("tabs bar is visible showing both filenames", async ({ terminal }) => {
      await expect(terminal.getByText(/1.*demo-content/g)).toBeVisible()
      await expect(terminal.getByText(/2.*demo-scratch/g)).toBeVisible()
    })

    test("gt switches buffer and the active tab changes", async ({ terminal }) => {
      // First buffer content should be visible initially
      await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

      // Switch to next buffer with gt
      await Keys.pressKeys(terminal, ["g", "t"])
      await Keys.delay(200)

      // Should now see second buffer's content
      await expect(terminal.getByText("This is a scratch buffer")).toBeVisible()
    })

    test("gT switches back to the first buffer", async ({ terminal }) => {
      await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

      // Switch forward with gt
      await Keys.pressKeys(terminal, ["g", "t"])
      await Keys.delay(100)
      await expect(terminal.getByText("This is a scratch buffer")).toBeVisible()

      // Switch back with gT
      await Keys.pressKeys(terminal, ["g", "T"])
      await Keys.delay(100)
      await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
    })

    test("both tabs show filenames, not [No Name]", async ({ terminal }) => {
      await expect(terminal.getByText(/1.*demo-content/g)).toBeVisible()
      await expect(terminal.getByText(/2.*demo-scratch/g)).toBeVisible()

      const buffer = Keys.visibleBuffer(terminal)
      expect(buffer).not.toContain("[No Name]")
    })
  })

  test.describe("CLI with two files", () => {
    test.use(withFiles([DEMO_FIXTURE, BUFFER2_FIXTURE]))

    test("tabs bar is visible showing both filenames", async ({ terminal }) => {
      await expect(terminal.getByText(/1.*demo-content/g)).toBeVisible()
      await expect(terminal.getByText(/2.*buffer2-content/g)).toBeVisible()
    })

    test("gt switches buffer and the tabs bar updates accordingly", async ({ terminal }) => {
      await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

      // Switch to next buffer with gt
      await Keys.pressKeys(terminal, ["g", "t"])
      await Keys.delay(200)

      // Should now see second file's content
      await expect(terminal.getByText("This is file number two.")).toBeVisible()
    })

    test("gT switches back and the tabs bar updates accordingly", async ({ terminal }) => {
      await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

      // Switch forward with gt
      await Keys.pressKeys(terminal, ["g", "t"])
      await Keys.delay(100)
      await expect(terminal.getByText("This is file number two.")).toBeVisible()

      // Switch back with gT
      await Keys.pressKeys(terminal, ["g", "T"])
      await Keys.delay(100)
      await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
    })
  })
})
