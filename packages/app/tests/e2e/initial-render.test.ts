import { expect, startRevim, test } from "./test-utils.js"

test.beforeEach(startRevim())

test("initial render shows demo text", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  await expect(terminal).toMatchSnapshot({ includeColors: true })
})
