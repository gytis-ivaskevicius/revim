import { defineConfig } from "@microsoft/tui-test";
import { availableParallelism } from "node:os";

export default defineConfig({
  testMatch: "app/tests/**/*.test.ts",
  retries: 0,
  workers: 100
});
