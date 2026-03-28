import { test, expect, testConfig, RENDER_DELAY_MS } from "./test-utils.js";

test("initial render shows demo text", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible();
  await expect(terminal).toMatchSnapshot({ includeColors: true });
});