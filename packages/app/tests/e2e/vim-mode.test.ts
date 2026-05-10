import { expect, Keys, startRevim, test } from "./test-utils.js"

test.beforeEach(startRevim())

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
    keys: ["i", "a", "b", ".", "c", "d", " ", "e", "f", "<Esc>", "0", "W", "c", "i", "W", "X", "<Esc>"],
    expected: "ab.cd X to ReVim!",
  },
]

for (const { name, keys, expected } of bufferCases) {
  test(name, async ({ terminal }) => {
    await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
    await Keys.pressKeys(terminal, keys)

    const bufferText = Keys.visibleBuffer(terminal)
    if (!bufferText.includes(expected)) {
      throw new Error(`Unexpected buffer for ${name}:\n${bufferText}`)
    }
  })
}
