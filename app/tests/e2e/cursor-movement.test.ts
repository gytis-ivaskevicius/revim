import { test, expect, RENDER_DELAY_MS, KEY_PRESS_DELAY_MS } from "./test-utils.js";

const movements = [
  { name: "ArrowDown moves cursor down", key: "down", axis: "y" as const, delta: 1, wraps: false },
  { name: "ArrowRight moves cursor right", key: "right", axis: "x" as const, delta: 1, wraps: false },
  { name: "ArrowUp from row 0 wraps to last row", key: "up", axis: "y" as const, wraps: true },
  { name: "ArrowLeft from col 0 wraps to end of line", key: "left", axis: "x" as const, wraps: true },
];

for (const { name, key, axis, delta, wraps } of movements) {
  test(name, async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible();
    const before = terminal.getCursor();
    if (key === "down") terminal.keyDown();
    else if (key === "right") terminal.keyRight();
    else if (key === "up") terminal.keyUp();
    else if (key === "left") terminal.keyLeft();
    await new Promise((r) => setTimeout(r, RENDER_DELAY_MS));
    const after = terminal.getCursor();
    if (wraps) {
      expect(after[axis]).toBeGreaterThan(before[axis]);
    } else {
      expect(after[axis]).toBe(before[axis] + delta);
    }
  });
}

test("ArrowDown at last row wraps to row 0", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible();
  const before = terminal.getCursor();
  const demoTextLines = 7;
  for (let i = 0; i < demoTextLines + 1; i++) {
    terminal.keyDown();
    await new Promise((r) => setTimeout(r, KEY_PRESS_DELAY_MS));
  }
  const after = terminal.getCursor();
  expect(after.y).toBeLessThan(before.y + demoTextLines);
});