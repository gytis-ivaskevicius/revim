import { expect, KEY_PRESS_DELAY_MS, Keys, startRevim, test } from "./test-utils.js"

test.beforeEach(startRevim())

test("keys.delay() resolves after ~KEY_PRESS_DELAY_MS", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const before = Date.now()
  await Keys.delay()
  const after = Date.now()
  expect(after - before).toBeGreaterThanOrEqual(KEY_PRESS_DELAY_MS - 2)
  expect(after - before).toBeLessThan(KEY_PRESS_DELAY_MS + 50)
})

test("keys.delay(100) resolves after ~100ms", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const before = Date.now()
  await Keys.delay(100)
  const after = Date.now()
  expect(after - before).toBeGreaterThanOrEqual(95)
  expect(after - before).toBeLessThan(200)
})

test("keys.pressKeys sends keys in order with delays between them", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  await Keys.pressKeys(terminal, ["i", "a", "b", "c"])
  await Keys.pressKeys(terminal, ["<Esc>"])
  const buffer = Keys.visibleBuffer(terminal)
  expect(buffer).toContain("abc")
})

test("keys.pressKeys with Escape calls terminal.keyEscape()", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  await Keys.pressKeys(terminal, ["i"])
  await expect(terminal.getByText("INSERT")).toBeVisible()
  await Keys.pressKeys(terminal, ["<Esc>"])
  await expect(terminal.getByText("NORMAL")).toBeVisible()
})

test("keys.pressKeys with modifier sends with modifiers", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  await Keys.pressKeys(terminal, [{ key: "v", ctrl: true }])
  await expect(terminal).toMatchSnapshot({ includeColors: true })
})

test("keys.visibleBuffer returns non-empty string for working terminal", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  const buffer = Keys.visibleBuffer(terminal)
  expect(typeof buffer).toBe("string")
  expect(buffer.length).toBeGreaterThan(0)
})
