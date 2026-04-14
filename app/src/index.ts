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
  log(`[processKeyEvent] 1 START key: ${event.key}`)
  try {
    const insertMode = Boolean(vimMode.adapter.state.vim?.insertMode)
    log(`[processKeyEvent] 2 insertMode: ${insertMode}`)
    const encodedKey = encodeTerminalKey(event, insertMode)
    log(`[processKeyEvent] 3 encodedKey: ${encodedKey}`)
    log(`[processKeyEvent] 4 keyMap: ${vimMode.adapter.state.keyMap}`)
    log(`[processKeyEvent] 5 calling vimMode.handleKey`)
    vimMode.handleKey(encodedKey)
    log(`[processKeyEvent] 6 handleKey returned successfully`)
  } catch (e) {
    log(`[processKeyEvent] EXCEPTION in handleKey: ${e}`)
    throw e
  }
  log(`[processKeyEvent] 7 after handleKey, ${JSON.stringify(event)} processed`)
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
  const keepAlive = setInterval(() => {
    log(`[keepAlive] event loop alive`)
  }, 2_000)
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
      log(`[main loop] waiting for keyboard event...`)
      try {
        const event = (await waitForKeyboardEvent()) as KeyboardEvent
        log(`[keyboard] key: ${event.key} modifiers: ${event.modifiers}`)

        if (event.modifiers.includes("Ctrl") && normalizeCtrlCharacter(event.key) === "c") {
          log(`[keyboard] Ctrl+C detected, shutting down`)
          shutdown(0)
          return
        }

        processKeyEvent(vimMode, event)
        log(`[keyboard] event processed successfully ${JSON.stringify(event)}`)
      } catch (e) {
        console.error(`[keyboard] error processing key event: ${e}`)
        log(`[keyboard] error waiting for key: ${e}`)
        if (cleanedUp) break
      }
      log(`[main loop] iteration complete, waiting for next event...`)
    }
  } finally {
    console.error(`[main] exiting main loop, performing cleanup`)
    cleanup()
  }
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
