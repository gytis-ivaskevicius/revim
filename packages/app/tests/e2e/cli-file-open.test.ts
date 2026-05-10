import { readFileSync } from "node:fs"
import { expect, startRevim, test, withFile } from "./test-utils.js"

const LOG = "/tmp/revim-cli-file-open-test.log"
const DEMO_FIXTURE = "packages/app/tests/fixtures/demo-content.md"

test.describe("CLI file opening", () => {
  test.beforeEach(startRevim())

  test("default launch (no file arg) shows Welcome to ReVim!", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  })
})

test.describe("CLI with explicit file arg", () => {
  test.beforeEach(withFile(DEMO_FIXTURE))

  test("shows the file's first line", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  })
})

test.describe("CLI with --log and file arg", () => {
  test.beforeEach(startRevim(["--log", LOG, DEMO_FIXTURE]))

  test("shows file content and creates log", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

    const logContent = readFileSync(LOG, "utf-8")
    expect(logContent.length).toBeGreaterThan(0)
    expect(logContent).toContain("[TS] revim starting")
    expect(logContent).toContain("[RS] init_tui")
  })
})
