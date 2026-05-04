import path from "node:path"
import { fileURLToPath } from "node:url"
import { initTui, loadFile, shutdownTui, startKeyboardListener, waitForKeyboardEvent } from "@revim/lib"
import { createErrorWindow } from "./error-window"
import { closeLog, initLog, log } from "./log"
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

function parseFilePath(args: string[]): string | undefined {
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--log") {
      i++ // skip the next arg (log path)
      continue
    }
    if (arg === "run") continue
    if (arg.endsWith("index.ts")) continue
    return arg
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

  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const targetPath = parseFilePath(process.argv) ?? path.join(moduleDir, "../tests/fixtures/demo-content.md")
  loadFile(targetPath)

  const vimMode = new VimMode(new TerminalStatusBar())
  vimMode.enable()
  let cleanedUp = false

  const cleanup = () => {
    if (cleanedUp) {
      return
    }

    cleanedUp = true
    vimMode.disable()
    log("revim shutdown")
    shutdownTui()
    closeLog()
  }

  const shutdown = (exitCode: number) => {
    cleanup()
    process.exit(exitCode)
  }

  const handleSigint = () => shutdown(0)
  process.on("SIGINT", handleSigint)

  startKeyboardListener()

  const errorWindow = createErrorWindow(10, 30000)

  try {
    while (!cleanedUp) {
      try {
        const event = (await waitForKeyboardEvent()) as KeyboardEvent

        if (event.modifiers.includes("Ctrl") && normalizeCtrlCharacter(event.key) === "c") {
          shutdown(0)
          return
        }

        processKeyEvent(vimMode, event)
        // Note: success does NOT reset the error window — it slides naturally by time
      } catch (_e) {
        log(`key processing error: ${_e}`)
        if (errorWindow.record()) {
          log("too many errors in sliding window, shutting down")
          shutdown(1)
          return
        }
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
