import { expect, test } from "@microsoft/tui-test"

export const testConfig = {
  program: { file: "bun", args: ["run", "app/src/index.ts"] },
  rows: 30,
  columns: 80,
}

test.use(testConfig)

export { expect, test }

export const RENDER_DELAY_MS = 100
export const KEY_PRESS_DELAY_MS = 50
