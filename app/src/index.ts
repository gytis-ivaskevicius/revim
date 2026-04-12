import { initTui, shutdownTui, startKeyboardListener } from "@revim/lib"
import { encodeTerminalKey, normalizeCtrlCharacter } from "./terminal-key"
import { VimMode } from "./vim"
import TerminalStatusBar from "./vim/terminal-status-bar"

function processKeyEvent(vimMode: VimMode, event: { key: string; modifiers: string[] }) {
  const insertMode = Boolean(vimMode.adapter.state.vim?.insertMode)
  vimMode.handleKey(encodeTerminalKey(event, insertMode))
}

async function main() {
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
