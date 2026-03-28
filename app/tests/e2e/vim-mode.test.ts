import { test, expect, KEY_PRESS_DELAY_MS } from "./test-utils.js";

const delay = () => new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));

const visibleBuffer = (terminal: { getViewableBuffer: () => string[][] }) =>
  terminal.getViewableBuffer().map((row) => row.join("")).join("\n");

async function pressKeys(
  terminal: {
    keyPress: (key: string) => void;
    keyEscape: () => void;
    keyBackspace: () => void;
    keyDelete: () => void;
    keyLeft: () => void;
  },
  keys: string[]
) {
  for (const key of keys) {
    switch (key) {
      case "<Esc>":
        terminal.keyEscape();
        break;
      case "<BS>":
        terminal.keyBackspace();
        break;
      case "<Del>":
        terminal.keyDelete();
        break;
      case "<Left>":
        terminal.keyLeft();
        break;
      default:
        terminal.keyPress(key);
        break;
    }
    await delay();
  }
}

const bufferCases = [
  {
    name: "insert mode writes text into the buffer",
    keys: ["i", "a", "b", "c", "<Esc>", "x"],
    expected: "abWelcome to ReVim!",
  },
  {
    name: "insert mode supports backspace",
    keys: ["i", "a", "b", "c", "<BS>", "<Esc>"],
    expected: "abWelcome to ReVim!",
  },
  {
    name: "insert mode delete removes the character under the cursor",
    keys: ["i", "a", "b", "<Esc>", "<Left>", "i", "<Del>", "<Esc>"],
    expected: "bWelcome to ReVim!",
  },
  {
    name: "W and ciW operate on big words",
    keys: [
      "i",
      "a",
      "b",
      ".",
      "c",
      "d",
      " ",
      "e",
      "f",
      "<Esc>",
      "0",
      "W",
      "c",
      "i",
      "W",
      "X",
      "<Esc>",
    ],
    expected: "ab.cd X to ReVim!",
  },
];

for (const { name, keys, expected } of bufferCases) {
  test(name, async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible();
    await pressKeys(terminal, keys);

    const bufferText = visibleBuffer(terminal);
    if (!bufferText.includes(expected)) {
      throw new Error(`Unexpected buffer for ${name}:\n${bufferText}`);
    }
  });
}
