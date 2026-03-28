import { test, expect } from "@microsoft/tui-test";

test.use({
  program: { file: "bun", args: ["run", "app/src/index.ts"] },
  rows: 30,
  columns: 80,
});

test("initial render shows demo text", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible();
  await expect(terminal).toMatchSnapshot({ includeColors: true });
});