import { test, expect } from "./test-utils.js";

test("Ctrl+C exits cleanly", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible();
  const exitPromise = new Promise<void>((resolve) => {
    terminal.onExit(() => resolve());
  });
  terminal.keyCtrlC();
  await exitPromise;
  expect(terminal.exitResult?.exitCode).toBe(0);
});