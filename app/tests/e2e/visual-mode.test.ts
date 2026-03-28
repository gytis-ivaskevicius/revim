import { test, expect, KEY_PRESS_DELAY_MS } from "./test-utils.js";

const delay = () => new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS));

const visibleBuffer = (terminal: { getViewableBuffer: () => string[][] }) =>
  terminal.getViewableBuffer().map((row) => row.join("")).join("\n");

const cellShift = (
  terminal: { serialize: () => { shifts: Map<string, { inverse?: number }> } },
  x: number,
  y: number
) => terminal.serialize().shifts.get(`${x},${y}`);

async function pressKeys(
  terminal: {
    keyPress: (key: string, options?: { ctrl?: boolean; alt?: boolean; shift?: boolean }) => void;
    keyEscape: () => void;
  },
  keys: Array<string | { key: string; ctrl?: boolean; alt?: boolean; shift?: boolean }>
) {
  for (const key of keys) {
    if (key === "<Esc>") {
      terminal.keyEscape();
    } else if (typeof key === "string") {
      terminal.keyPress(key);
    } else {
      terminal.keyPress(key.key, key);
    }
    await delay();
  }
}

test("charwise visual selection renders reversed cells", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible();
  await pressKeys(terminal, ["v"]);

  expect(cellShift(terminal, 1, 1)?.inverse).toBe(67108864);

  await expect(terminal).toMatchSnapshot({ includeColors: true });
});

test("charwise visual motion extends the selection", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible();
  await pressKeys(terminal, ["v", "l"]);

  expect(cellShift(terminal, 1, 1)?.inverse).toBe(67108864);

  await expect(terminal).toMatchSnapshot({ includeColors: true });
});

test("charwise visual delete removes selected text", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible();
  await pressKeys(terminal, ["v", "e", "d"]);

  const bufferText = visibleBuffer(terminal);
  if (bufferText.includes("Welcome to ReVim!")) {
    throw new Error(`Expected selected word to be deleted:\n${bufferText}`);
  }
  await expect(terminal.getByText(" to ReVim!")).toBeVisible();
});

test("linewise visual selection highlights the full line", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible();
  await pressKeys(terminal, [{ key: "V", shift: true }]);
  await expect(terminal).toMatchSnapshot({ includeColors: true });
});

test("escape clears visual selection", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible();
  await pressKeys(terminal, ["v", "l", "<Esc>"]);
  await expect(terminal).toMatchSnapshot({ includeColors: true });
});

test("blockwise visual selection highlights the same column across rows", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible();
  await pressKeys(terminal, [{ key: "v", ctrl: true }, "j"]);

  expect(cellShift(terminal, 1, 1)?.inverse).toBe(67108864);
  expect(cellShift(terminal, 1, 2)?.inverse).toBe(67108864);

  await expect(terminal).toMatchSnapshot({ includeColors: true });
});
