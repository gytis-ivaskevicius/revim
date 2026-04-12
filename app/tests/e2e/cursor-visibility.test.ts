import { expect, KEY_PRESS_DELAY_MS, RENDER_DELAY_MS, test } from "./test-utils.js"

const delay = () => new Promise((resolve) => setTimeout(resolve, KEY_PRESS_DELAY_MS))

test("initial render snapshot has no inverse on cursor cell", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  await expect(terminal).toMatchSnapshot({ includeColors: true })
})

test("ArrowRight x4 snapshot has no inverse on cursor cell", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const initial = terminal.getCursor()
  for (let i = 0; i < 4; i++) {
    terminal.keyRight()
    await delay()
  }
  await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
  const after = terminal.getCursor()
  expect(after.x).toBe(initial.x + 4)
  await expect(terminal).toMatchSnapshot({ includeColors: true })
})

test("ArrowDown x1 snapshot has no inverse on cursor cell", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const initial = terminal.getCursor()
  terminal.keyDown()
  await delay()
  await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
  const after = terminal.getCursor()
  expect(after.y).toBe(initial.y + 1)
  await expect(terminal).toMatchSnapshot({ includeColors: true })
})

test("v + ArrowRight x3 preserves visual selection inverse", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  terminal.keyPress("v")
  await delay()
  const initial = terminal.getCursor()
  for (let i = 0; i < 3; i++) {
    terminal.keyRight()
    await delay()
  }
  await new Promise((r) => setTimeout(r, RENDER_DELAY_MS))
  expect(terminal.getCursor().x).toBe(initial.x + 3)
  await expect(terminal).toMatchSnapshot({ includeColors: true })
})
