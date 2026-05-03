import { defineConfig } from "@microsoft/tui-test"

export default defineConfig({
  testMatch: "app/tests/e2e/**/*.test.ts",
  retries: 2,
  workers: 100,
})
