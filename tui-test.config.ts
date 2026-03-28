import { defineConfig } from "@microsoft/tui-test";

export default defineConfig({
  testMatch: "app/tests/**/*.test.ts",
  retries: 0,
  workers: 100,
});
