import { expect, test } from "@microsoft/tui-test"

export const testConfig = {
  rows: 30,
  columns: 80,
}

test.use(testConfig)

export { expect, test }

export const RENDER_DELAY_MS = 30
export const KEY_PRESS_DELAY_MS = 10

export type KeyInput = string | { key: string; ctrl?: boolean; alt?: boolean; shift?: boolean }

const REVIM_CMD = "bun run packages/app/src/index.ts"

// Returns a beforeEach hook that launches revim in the shell and waits until the
// welcome screen is visible. Use as: test.beforeEach(startRevim()) or
// test.beforeEach(startRevim(["--log", path, "file.txt"])).
export function startRevim(args: string[] = []) {
  return async ({ terminal }: any) => {
    terminal.write([REVIM_CMD, ...args].join(" "))
    terminal.keyPress("Enter")
    await expect(terminal.getByText("NORMAL")).toBeVisible()
  }
}

export const withFile = (filePath: string) => startRevim([filePath])
export const withFiles = (filePaths: string[]) => startRevim(filePaths)
export const withLog = (logPath: string) => startRevim(["--log", logPath])

// Use in test.use() for tests that need to inspect the exit code (terminal.onExit,
// terminal.exitResult). These tests cannot use shell mode because the shell process
// stays alive after revim exits, so onExit never fires.
export const programConfig = (args: string[] = []) => ({
  program: { file: "bun", args: ["run", "packages/app/src/index.ts", ...args] },
})

type TerminalKeyApi = {
  keyPress: (key: string, options?: { ctrl?: boolean; alt?: boolean; shift?: boolean }) => void
  keyEscape: () => void
  keyBackspace: () => void
  keyDelete: () => void
  keyLeft: () => void
  keyRight: () => void
  keyUp: () => void
  keyDown: () => void
}

function dispatchKey(terminal: any, key: string): boolean {
  if (key === "<Esc>" || key === "Escape") {
    terminal.keyEscape()
    return true
  }
  if (key === "<BS>" || key === "Backspace") {
    terminal.keyBackspace()
    return true
  }
  if (key === "<Del>" || key === "Delete") {
    terminal.keyDelete()
    return true
  }
  if (key === "<Left>" || key === "Left") {
    terminal.keyLeft()
    return true
  }
  if (key === "<Right>" || key === "Right") {
    terminal.keyRight()
    return true
  }
  if (key === "<Up>" || key === "Up") {
    terminal.keyUp()
    return true
  }
  if (key === "<Down>" || key === "Down") {
    terminal.keyDown()
    return true
  }
  if (key === "<Enter>") {
    terminal.keyPress("Enter")
    return true
  }
  if (key === "<Space>") {
    terminal.keyPress(" ")
    return true
  }
  return false
}

export const Keys = {
  delay(ms?: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms ?? KEY_PRESS_DELAY_MS))
  },

  visibleBuffer(terminal: { getViewableBuffer: () => string[][] }): string {
    return terminal
      .getViewableBuffer()
      .map((row) => row.join(""))
      .join("\n")
  },

  async pressKeys(terminal: TerminalKeyApi, keys: KeyInput[], options?: { delay?: number }): Promise<void> {
    const delayMs = options?.delay ?? KEY_PRESS_DELAY_MS
    for (const key of keys) {
      await this.pressKey(terminal, key)
      await this.delay(delayMs)
    }
  },

  keyPress(terminal: any, key: string): void {
    if (!dispatchKey(terminal, key)) {
      if (typeof terminal.keyPress === "function") {
        terminal.keyPress(key)
      } else if (typeof terminal.key === "function") {
        terminal.key(key)
      } else {
        throw new Error("Terminal does not support keyPress/key")
      }
    }
  },

  async pressKey(terminal: TerminalKeyApi, key: KeyInput): Promise<void> {
    if (typeof key === "string") {
      if (!dispatchKey(terminal, key)) {
        terminal.keyPress(key)
      }
    } else {
      terminal.keyPress(key.key, key)
    }
  },
}
