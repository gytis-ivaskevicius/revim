import { test, expect } from "@microsoft/tui-test";

test.use({
  program: { file: "bun", args: ["run", "app/src/index.ts"] },
  rows: 30,
  columns: 80,
});

test("Ctrl+C exits cleanly", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible();
  const exitPromise = new Promise<void>((resolve) => {
    terminal.onExit(() => resolve());
  });
  terminal.keyCtrlC();
  await exitPromise;
  expect(terminal.exitResult?.exitCode).toBe(0);
});