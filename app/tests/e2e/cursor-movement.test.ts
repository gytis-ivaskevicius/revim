import { expect, KEY_PRESS_DELAY_MS, RENDER_DELAY_MS, test } from "./test-utils.js"

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

test("ArrowDown at last row stays on last row", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible()
  const before = terminal.getCursor()
  const demoTextLines = 27
  for (let i = 0; i < demoTextLines + 1; i++) {
    terminal.keyDown()
    await new Promise((r) => setTimeout(r, KEY_PRESS_DELAY_MS))
  }
  const after = terminal.getCursor()
  expect(after.y).toBeGreaterThanOrEqual(before.y + demoTextLines - 1)
})
