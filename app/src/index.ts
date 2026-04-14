import { initTui, shutdownTui, startKeyboardListener, waitForKeyboardEvent } from "@revim/lib"
import { initLog, log } from "./log"
import { encodeTerminalKey, normalizeCtrlCharacter } from "./terminal-key"
import { VimMode } from "./vim"
import TerminalStatusBar from "./vim/terminal-status-bar"

interface KeyboardEvent {
  key: string
  modifiers: string[]
}

function parseLogPath(args: string[]): string | undefined {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === "--log") {
      return args[i + 1]
    }
  }
  return undefined
}

function processKeyEvent(vimMode: VimMode, event: KeyboardEvent) {
  const insertMode = Boolean(vimMode.adapter.state.vim?.insertMode)
  const encodedKey = encodeTerminalKey(event, insertMode)
  vimMode.handleKey(encodedKey)
}

async function main() {
  const logPath = parseLogPath(process.argv)
  if (logPath) {
    initLog(logPath)
    log("revim starting")
  }

  initTui()

  const vimMode = new VimMode(new TerminalStatusBar())
  vimMode.enable()
  let cleanedUp = false

  const cleanup = () => {
    if (cleanedUp) {
      return
    }

    cleanedUp = true
    vimMode.disable()
    shutdownTui()
    log("revim shutdown")
  }

  const shutdown = (exitCode: number) => {
    cleanup()
    process.exit(exitCode)
  }

  const handleSigint = () => shutdown(0)
  process.on("SIGINT", handleSigint)

  startKeyboardListener()

  try {
    while (!cleanedUp) {
      try {
        const event = (await waitForKeyboardEvent()) as KeyboardEvent

        if (event.modifiers.includes("Ctrl") && normalizeCtrlCharacter(event.key) === "c") {
          shutdown(0)
          return
        }

        processKeyEvent(vimMode, event)
      } catch (_e) {
        if (cleanedUp) break
      }
    }
  } finally {
    cleanup()
  }
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
