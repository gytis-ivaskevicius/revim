import { expect, Keys, RENDER_DELAY_MS, test } from "./test-utils.js"

test("terminal resize to wider dimensions updates display", async ({ terminal }) => {
  // Initial render at 80x30
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  // Resize to 120x40
  terminal.resize(120, 40)
  await Keys.delay(RENDER_DELAY_MS)

  // After resize, content should still be visible and status bar should show mode
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  await expect(terminal.getByText(/NORMAL/g)).toBeVisible()
})

test("terminal resize to smaller dimensions updates display", async ({ terminal }) => {
  // Initial render at 80x30
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()

  // Resize to 40x15
  terminal.resize(40, 15)
  await Keys.delay(RENDER_DELAY_MS)

  // After resize, status bar should still show mode label
  await expect(terminal.getByText(/NORMAL/g)).toBeVisible()
})
