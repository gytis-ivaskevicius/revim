import { readFileSync } from "node:fs"
import { expect, keyPress, RENDER_DELAY_MS, test, withLog } from "./test-utils.js"

const LOG = "/tmp/revim-logging-test.log"

test.describe("logging", () => {
  test.use(withLog(LOG))

  test("logs key events and render cycles", async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
    keyPress(terminal, "j")
    await new Promise((resolve) => setTimeout(resolve, RENDER_DELAY_MS))

    const logContent = readFileSync(LOG, "utf-8")
    const lines = logContent.split("\n").filter((line) => line.length > 0)

    expect(lines.some((line) => line.includes("[TS] revim starting"))).toBe(true)
    expect(lines.some((line) => line.includes("[RS] init_tui"))).toBe(true)
    expect(lines.some((line) => line.includes("[TS] key: 'j'"))).toBe(true)
    expect(lines.some((line) => line.includes("[RS] render_frame_internal"))).toBe(true)

    const lineRegex = /^\[.*\] \[(TS|RS)\] .*$/
    for (const line of lines) {
      expect(line).toMatch(lineRegex)
    }
  })
})
