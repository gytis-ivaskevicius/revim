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
  return Keys.keyPress(terminal, key)
}

export function keyEscape(terminal: any) {
  if (typeof terminal.keyEscape === "function") return terminal.keyEscape()
  if (typeof terminal.key === "function") return terminal.key("Escape")
  throw new Error("Terminal does not support keyEscape/key")
}

export function withLog(logPath: string) {
  return { program: { file: "bun", args: ["run", "app/src/index.ts", "--log", logPath] } }
}

export type KeyInput = string | { key: string; ctrl?: boolean; alt?: boolean; shift?: boolean }

export class Keys {
  static delay(ms?: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms ?? KEY_PRESS_DELAY_MS))
  }

  static visibleBuffer(terminal: { getViewableBuffer: () => string[][] }): string {
    return terminal
      .getViewableBuffer()
      .map((row) => row.join(""))
      .join("\n")
  }

  static async pressKeys(
    terminal: {
      keyPress: (key: string, options?: { ctrl?: boolean; alt?: boolean; shift?: boolean }) => void
      keyEscape: () => void
      keyBackspace: () => void
      keyDelete: () => void
      keyLeft: () => void
      keyRight: () => void
      keyUp: () => void
      keyDown: () => void
    },
    keys: KeyInput[],
    options?: { delay?: number },
  ): Promise<void> {
    const delayMs = options?.delay ?? KEY_PRESS_DELAY_MS
    for (const key of keys) {
      await this.pressKey(terminal, key)
      await this.delay(delayMs)
    }
  }

  static keyPress(terminal: any, key: string): void {
    if (key === "<Esc>" || key === "Escape") {
      if (typeof terminal.keyEscape === "function") {
        terminal.keyEscape()
        return
      }
    }
    if (key === "<BS>" || key === "Backspace") {
      if (typeof terminal.keyBackspace === "function") {
        terminal.keyBackspace()
        return
      }
    }
    if (key === "<Del>" || key === "Delete") {
      if (typeof terminal.keyDelete === "function") {
        terminal.keyDelete()
        return
      }
    }
    if (key === "<Left>" || key === "Left") {
      if (typeof terminal.keyLeft === "function") {
        terminal.keyLeft()
        return
      }
    }
    if (key === "<Right>" || key === "Right") {
      if (typeof terminal.keyRight === "function") {
        terminal.keyRight()
        return
      }
    }
    if (key === "<Up>" || key === "Up") {
      if (typeof terminal.keyUp === "function") {
        terminal.keyUp()
        return
      }
    }
    if (key === "<Down>" || key === "Down") {
      if (typeof terminal.keyDown === "function") {
        terminal.keyDown()
        return
      }
    }
    if (typeof terminal.keyPress === "function") {
      terminal.keyPress(key)
      return
    }
    if (typeof terminal.key === "function") {
      terminal.key(key)
      return
    }
    throw new Error("Terminal does not support keyPress/key")
  }

  private static async pressKey(
    terminal: {
      keyPress: (key: string, options?: { ctrl?: boolean; alt?: boolean; shift?: boolean }) => void
      keyEscape: () => void
      keyBackspace: () => void
      keyDelete: () => void
      keyLeft: () => void
      keyRight: () => void
      keyUp: () => void
      keyDown: () => void
    },
    key: KeyInput,
  ): Promise<void> {
    if (key === "<Esc>") {
      terminal.keyEscape()
    } else if (key === "<BS>") {
      terminal.keyBackspace()
    } else if (key === "<Del>") {
      terminal.keyDelete()
    } else if (key === "<Left>") {
      terminal.keyLeft()
    } else if (key === "<Right>") {
      terminal.keyRight()
    } else if (key === "<Up>") {
      terminal.keyUp()
    } else if (key === "<Down>") {
      terminal.keyDown()
    } else if (key === "<Enter>") {
      terminal.keyPress("Enter")
    } else if (key === "<Space>") {
      terminal.keyPress(" ")
    } else if (typeof key === "string") {
      terminal.keyPress(key)
    } else {
      terminal.keyPress(key.key, key)
    }
  }
}
