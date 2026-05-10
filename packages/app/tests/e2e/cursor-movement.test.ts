import { expect, RENDER_DELAY_MS, startRevim, test } from "./test-utils.js"

test.beforeEach(startRevim())

const movements = [
  { name: "ArrowDown moves cursor down", key: "down", axis: "y" as const, delta: 1 },
  { name: "ArrowRight moves cursor right", key: "right", axis: "x" as const, delta: 1 },
  { name: "ArrowUp at top row stays put", key: "up", axis: "y" as const, delta: 0 },
  { name: "ArrowLeft at col 0 stays put", key: "left", axis: "x" as const, delta: 0 },
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
