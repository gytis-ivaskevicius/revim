import { test, expect } from "./test-utils.js";
import { encodeTerminalKey, normalizeCtrlCharacter } from "../../src/terminal-key.js";

test("Ctrl+C is encoded as expected", () => {
  expect(
    encodeTerminalKey(
      { key: normalizeCtrlCharacter(String.fromCharCode(3)), modifiers: ["Ctrl"] },
      false
    )
  ).toBe("Ctrl-c");
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

test("app stays running without Ctrl+C", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible();
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(terminal.exitResult).toBeNull();
});
