import { expect, RENDER_DELAY_MS, test } from "./test-utils.js"

const movements = [
  { name: "ArrowDown moves cursor down", key: "down", axis: "y" as const, delta: 1, wraps: false },
  { name: "ArrowRight moves cursor right", key: "right", axis: "x" as const, delta: 1, wraps: false },
  { name: "ArrowUp at top row stays put", key: "up", axis: "y" as const, wraps: false, delta: 0 },
  { name: "ArrowLeft at col 0 stays put", key: "left", axis: "x" as const, wraps: false, delta: 0 },
]

for (const { name, key, axis, delta } of movements) {
  test(name, async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible()
    const before = terminal.getCursor()
    if (key === "down") terminal.keyDown()
    else if (key === "right") terminal.keyRight()
    else if (key === "up") terminal.keyUp()
    else if (key === "left") terminal.keyLeft()
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
    const after = terminal.getCursor()
    expect(after[axis]).toBe(before[axis] + (delta ?? 0))
  })
}

test("ArrowDown at last row wraps to first row", async ({ terminal }) => {
  // Verify that ArrowDown at last row wraps to first row
  await expect(terminal.getByText("Welcome")).toBeVisible()
  // Get initial cursor position
  const initial = terminal.getCursor()
  // Navigate to last row with G
  terminal.keyEscape()
  await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
  terminal.keyPress("G")
  await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
  const atLast = terminal.getCursor()
  // Verify we're at the last row (bottom of viewport when scrolled)
  expect(atLast.y).toBeGreaterThan(initial.y)
  // Press ArrowDown - should wrap cursor to first row
  terminal.keyDown()
  await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
  await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
  // After wrapping, pressing 'g' twice should show first line content
  terminal.keyPress("g")
  await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
  terminal.keyPress("g")
  await new Promise((r) => setTimeout(r, RENDER_DELAY_MS * 2))
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
})
