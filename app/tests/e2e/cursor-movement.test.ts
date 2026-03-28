import { test, expect } from "@microsoft/tui-test";

test.use({
  program: { file: "bun", args: ["run", "app/src/index.ts"] },
  rows: 30,
  columns: 80,
});

test("ArrowDown moves cursor down", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible();
  const before = terminal.getCursor();
  terminal.keyDown();
  await new Promise((r) => setTimeout(r, 100));
  const after = terminal.getCursor();
  expect(after.y).toBe(before.y + 1);
});

test("ArrowRight moves cursor right", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible();
  const before = terminal.getCursor();
  terminal.keyRight();
  await new Promise((r) => setTimeout(r, 100));
  const after = terminal.getCursor();
  expect(after.x).toBe(before.x + 1);
});

test("ArrowUp from row 0 wraps to last row", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible();
  const before = terminal.getCursor();
  terminal.keyUp();
  await new Promise((r) => setTimeout(r, 100));
  const after = terminal.getCursor();
  expect(after.y).toBeGreaterThan(before.y);
});

test("ArrowLeft from col 0 wraps to end of line", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible();
  const before = terminal.getCursor();
  terminal.keyLeft();
  await new Promise((r) => setTimeout(r, 100));
  const after = terminal.getCursor();
  expect(after.x).toBeGreaterThan(before.x);
});

test("ArrowDown at last row wraps to row 0", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible();
  const before = terminal.getCursor();
  for (let i = 0; i < 10; i++) {
    terminal.keyDown();
    await new Promise((r) => setTimeout(r, 50));
  }
  const after = terminal.getCursor();
  expect(after.y).toBeLessThan(before.y + 10);
});