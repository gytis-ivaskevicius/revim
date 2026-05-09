import { expect, Keys, RENDER_DELAY_MS, test } from "./test-utils.js"

test("initial render snapshot has no inverse on cursor cell", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  await expect(terminal).toMatchSnapshot({ includeColors: true })
})

test("ArrowRight x4 snapshot has no inverse on cursor cell", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const initial = terminal.getCursor()
  await Keys.pressKeys(terminal, ["<Right>", "<Right>", "<Right>", "<Right>"])
  await Keys.delay(RENDER_DELAY_MS)
  const after = terminal.getCursor()
  expect(after.x).toBe(initial.x + 4)
  await expect(terminal).toMatchSnapshot({ includeColors: true })
})

test("ArrowDown x1 snapshot has no inverse on cursor cell", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const initial = terminal.getCursor()
  await Keys.pressKeys(terminal, ["<Down>"])
  await Keys.delay(RENDER_DELAY_MS)
  const after = terminal.getCursor()
  expect(after.y).toBe(initial.y + 1)
  await expect(terminal).toMatchSnapshot({ includeColors: true })
})

test("v + ArrowRight x3 preserves visual selection inverse", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  await Keys.pressKeys(terminal, ["v"])
  const initial = terminal.getCursor()
  await Keys.pressKeys(terminal, ["<Right>", "<Right>", "<Right>"])
  await Keys.delay(RENDER_DELAY_MS)
  expect(terminal.getCursor().x).toBe(initial.x + 3)
  await expect(terminal).toMatchSnapshot({ includeColors: true })
})
