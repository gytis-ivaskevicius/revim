import { initTui, shutdownTui, startKeyboardListener } from "@revim/lib"
import { initLog, log } from "./log"
import { encodeTerminalKey, normalizeCtrlCharacter } from "./terminal-key"
import { VimMode } from "./vim"
import TerminalStatusBar from "./vim/terminal-status-bar"

function parseLogPath(args: string[]): string | undefined {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === "--log") {
      return args[i + 1]
    }
  }
  return undefined
}

function processKeyEvent(vimMode: VimMode, event: { key: string; modifiers: string[] }) {
  const insertMode = Boolean(vimMode.adapter.state.vim?.insertMode)
  const encodedKey = encodeTerminalKey(event, insertMode)
  log(`key: ${encodedKey}`)
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
  const keepAlive = setInterval(() => {}, 1_000)
  let cleanedUp = false

  const cleanup = () => {
    if (cleanedUp) {
      return
    }

    cleanedUp = true
    clearInterval(keepAlive)
    process.removeListener("SIGINT", handleSigint)
    vimMode.disable()
    shutdownTui()
    if (logPath) {
      log("revim shutdown")
    }
  }

  const shutdown = (exitCode: number) => {
    cleanup()
    process.exit(exitCode)
  }

  const handleSigint = () => shutdown(0)
  process.on("SIGINT", handleSigint)

  try {
    startKeyboardListener((err, event) => {
      try {
        if (err) {
          throw err
        }

        if (event.modifiers.includes("Ctrl") && normalizeCtrlCharacter(event.key) === "c") {
          shutdown(0)
          return
        }

        processKeyEvent(vimMode, event)
      } catch (error) {
        console.error("Fatal error:", error)
        shutdown(1)
      }
    })

    await new Promise<never>(() => {})
  } finally {
    cleanup()
  }
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
