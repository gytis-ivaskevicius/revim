import { expect, Keys, startRevim, test } from "./test-utils.js"

test.beforeEach(startRevim())

const cellShift = (
  terminal: { serialize: () => { shifts: Map<string, { inverse?: number }> } },
  x: number,
  y: number,
) => terminal.serialize().shifts.get(`${x},${y}`)

const snapshotCases: Array<{
  name: string
  readyText?: string
  keys: Keys.KeyInput[]
  assertions?: (terminal: { serialize: () => { shifts: Map<string, { inverse?: number }> } }) => void
}> = [
  {
    name: "charwise visual selection renders reversed cells",
    readyText: "Welcome to ReVim!",
    keys: ["v"],
    assertions: (terminal) => {
      expect(cellShift(terminal, 1, 2)?.inverse).toBe(67108864)
    },
  },
  {
    name: "charwise visual motion extends the selection",
    readyText: "Welcome to ReVim!",
    keys: ["v", "l"],
    assertions: (terminal) => {
      expect(cellShift(terminal, 1, 2)?.inverse).toBe(67108864)
    },
  },
  {
    name: "linewise visual selection highlights the full line",
    readyText: "Welcome to ReVim!",
    keys: [{ key: "V", shift: true }],
  },
  {
    name: "linewise visual selection highlights empty lines",
    readyText: "Welcome to ReVim!",
    keys: [{ key: "V", shift: true }, "j"],
    assertions: (terminal) => {
      expect(cellShift(terminal, 1, 2)?.inverse).toBe(67108864)
      expect(cellShift(terminal, 1, 3)?.inverse).toBe(67108864)
    },
  },
  {
    name: "escape clears visual selection",
    readyText: "Welcome to ReVim!",
    keys: ["v", "l", "<Esc>"],
  },
  {
    name: "blockwise visual selection highlights the same column across rows",
    readyText: "Welcome to ReVim!",
    keys: [{ key: "v", ctrl: true }, "j"],
    assertions: (terminal) => {
      expect(cellShift(terminal, 1, 2)?.inverse).toBe(67108864)
      expect(cellShift(terminal, 1, 3)?.inverse).toBe(67108864)
    },
  },
  {
    name: "blockwise visual selection stays aligned past empty lines",
    readyText: "Welcome to ReVim!",
    keys: ["l", "l", "l", "l", "l", { key: "v", ctrl: true }, "j"],
    assertions: (terminal) => {
      expect(cellShift(terminal, 6, 2)?.inverse).toBe(67108864)
      expect(cellShift(terminal, 6, 3)?.inverse).toBe(67108864)
    },
  },
  {
    name: "blockwise visual selection can expand horizontally",
    readyText: "Welcome to ReVim!",
    keys: ["l", "l", "l", "l", "l", "l", "l", "l", { key: "v", ctrl: true }, "l"],
    assertions: (terminal) => {
      expect(cellShift(terminal, 9, 2)?.inverse).toBe(67108864)
      expect(cellShift(terminal, 11, 2)?.inverse).toBe(0)
    },
  },
]

for (const { name, readyText = "Welcome to ReVim!", keys, assertions } of snapshotCases) {
  test(name, async ({ terminal }) => {
    await expect(terminal.getByText(readyText)).toBeVisible()
    await Keys.pressKeys(terminal, keys)
    assertions?.(terminal)
    await expect(terminal).toMatchSnapshot({ includeColors: true })
  })
}

const deleteCases: Array<{
  name: string
  readyText: string
  keys: Keys.KeyInput[]
  absentText?: string
  presentText: string[]
}> = [
  {
    name: "charwise visual delete removes selected text",
    readyText: "Welcome to ReVim!",
    keys: ["v", "e", "d"],
    absentText: "Welcome to ReVim!",
    presentText: [" to ReVim!"],
  },
  {
    name: "charwise visual delete removes the full word on later lines",
    readyText: "Basic movement keys:",
    keys: ["j", "j", "j", "j", "j", "v", "e", "d"],
    absentText: "Basic movement keys:",
    presentText: ["movement keys:"],
  },
]

for (const { name, readyText, keys, absentText, presentText } of deleteCases) {
  test(name, async ({ terminal }) => {
    await expect(terminal.getByText(readyText)).toBeVisible()
    await Keys.pressKeys(terminal, keys)

    const bufferText = Keys.visibleBuffer(terminal)
    if (absentText && bufferText.includes(absentText)) {
      throw new Error(`Expected selected text to be deleted:\n${bufferText}`)
    }

    for (const text of presentText) {
      await expect(terminal.getByText(text)).toBeVisible()
    }
  })
}

test("blockwise x deletes columns without joining lines", async ({ terminal }) => {
  await expect(terminal.getByText("ReVim is a terminal-based text editor.")).toBeVisible()
  await Keys.pressKeys(terminal, ["j", "j", "j", { key: "v", ctrl: true }, "j"])
  await Keys.pressKeys(
    terminal,
    Array.from({ length: 10 }, () => "l"),
  )
  await Keys.pressKeys(terminal, ["x"])

  const bufferText = Keys.visibleBuffer(terminal)
  if (bufferText.includes(" Vim is a teBasic mov")) {
    throw new Error(`Expected block delete to preserve line breaks:\n${bufferText}`)
  }
  await expect(terminal.getByText("ed text editor.")).toBeVisible()
  await expect(terminal.getByText("ment keys:")).toBeVisible()
})
