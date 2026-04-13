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

test("ArrowDown at last row wraps to first row", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible()
  // Use G to jump to last line (row 46, the last of 47 lines)
  terminal.keyEscape()
  await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
  terminal.keyPress("G")
  await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
  // "End of demo buffer." should be visible
  await expect(terminal.getByText("End of demo buffer.")).toBeVisible()
  // Now press ArrowDown - with wrapping at 47 lines, cursor goes to first row
  terminal.keyDown()
  await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
  await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
  // Press gg to verify we can return to first line
  terminal.keyPress("g")
  await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
  terminal.keyPress("g")
  await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
  // "Welcome to ReVim!" should be visible
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
})
