import { test, expect, KEY_PRESS_DELAY_MS } from "./test-utils.js";

test("insert mode writes text into the buffer", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible();

  terminal.keyPress("i");
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  terminal.keyPress("a");
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  terminal.keyPress("b");
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  terminal.keyPress("c");
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  terminal.keyEscape();
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));

  const bufferText = terminal.getViewableBuffer().map((row) => row.join("")).join("\n");
  if (!bufferText.includes("abcWelcome to ReVim!")) {
    throw new Error(`Unexpected buffer after insert:\n${bufferText}`);
  }

  terminal.keyPress("x");
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  const afterDelete = terminal.getViewableBuffer().map((row) => row.join("")).join("\n");
  if (!afterDelete.includes("abWelcome to ReVim!") && !afterDelete.includes("bcWelcome to ReVim!")) {
    throw new Error(`Unexpected buffer after escape+x:\n${afterDelete}`);
  }
});

test("insert mode supports backspace and delete", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible();

  terminal.keyPress("i");
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  terminal.keyPress("a");
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  terminal.keyPress("b");
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  terminal.keyPress("c");
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  terminal.keyBackspace();
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  terminal.keyLeft();
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  terminal.keyDelete();
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  terminal.keyEscape();
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));

  const bufferText = terminal.getViewableBuffer().map((row) => row.join("")).join("\n");
  if (!bufferText.includes("abWelcome to ReVim!")) {
    throw new Error(`Unexpected buffer after backspace/delete:\n${bufferText}`);
  }
});

test("W and ciW operate on big words", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible();

  terminal.keyPress("i");
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  for (const key of ["a", "b", ".", "c", "d", " ", "e", "f"]) {
    terminal.keyPress(key);
    await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  }
  terminal.keyEscape();
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));

  terminal.keyPress("0");
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  terminal.keyPress("W");
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  terminal.keyPress("c");
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  terminal.keyPress("i");
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  terminal.keyPress("W");
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  terminal.keyPress("X");
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));
  terminal.keyEscape();
  await new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));

  const bufferText = terminal.getViewableBuffer().map((row) => row.join("")).join("\n");
  if (!bufferText.includes("ab.cd X to ReVim!")) {
    throw new Error(`Unexpected buffer after W/ciW:\n${bufferText}`);
  }
});
