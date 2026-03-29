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

// Re-export commonly used terminal key helpers to keep tests uniform
export function keyPress(terminal: any, key: string) {
  if (typeof terminal.keyPress === "function") return terminal.keyPress(key)
  if (typeof terminal.key === "function") return terminal.key(key)
  throw new Error("Terminal does not support keyPress/key")
}

export function keyEscape(terminal: any) {
  if (typeof terminal.keyEscape === "function") return terminal.keyEscape()
  if (typeof terminal.key === "function") return terminal.key("Escape")
  throw new Error("Terminal does not support keyEscape/key")
}
