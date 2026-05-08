import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  focusEditor,
  getCurrentPath,
  initTui,
  loadFile,
  openBuffer,
  saveFile,
  setCurrentPath,
  setStatusText,
  shutdownTui,
  startKeyboardListener,
  switchToBuffer,
  waitForKeyboardEvent,
} from "@revim/lib"
import { createErrorWindow } from "./error-window"
import { closeLog, initLog, log } from "./log"
import { encodeTerminalKey, normalizeCtrlCharacter } from "./terminal-key"
import { EditorAdapter, type FileEvent, VimMode } from "./vim"
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

function parseFilePaths(args: string[], scriptAbsPath: string): string[] {
  const filePaths: string[] = []
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]

    // Skip --log and its immediately following value
    if (arg === "--log") {
      i++
      continue
    }

    // Skip the script path (may be relative, absolute, or use ./ ../ prefixes)
    if (arg === "run" && i === 1) continue // "bun run <script>" — skip "run"
    if (path.resolve(arg) === scriptAbsPath) continue

    filePaths.push(arg)
  }
  return filePaths
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

  const scriptAbsPath = fileURLToPath(import.meta.url)
  const moduleDir = path.dirname(scriptAbsPath)
  const filePaths = parseFilePaths(process.argv, scriptAbsPath).map((p) => path.resolve(p))

  let firstFilePath: string
  if (filePaths.length === 0) {
    // No files specified: load demo content
    firstFilePath = path.join(moduleDir, "../tests/fixtures/demo-content.md")
    loadFile(firstFilePath)
  } else {
    // Load first file
    firstFilePath = filePaths[0]
    loadFile(firstFilePath)

    // Open additional files as buffers (but don't switch to them)
    for (let i = 1; i < filePaths.length; i++) {
      openBuffer(filePaths[i])
    }

    // Ensure first file is active
    switchToBuffer(0)
  }

  const statusBar = new TerminalStatusBar()
  statusBar.setFilePath(firstFilePath)
  const vimMode = new VimMode(statusBar)

  // Wire up the save-file event listener
  vimMode.addEventListener("save-file", (event: Event) => {
    const fileEvent = event as FileEvent
    let filename = fileEvent.filename.trim()
    // Treat "!" as empty (force flag without a filename)
    if (filename === "!") {
      filename = ""
    }
    const filePath = filename || getCurrentPath()
    if (!filePath) {
      setStatusText("No file name")
      return
    }
    try {
      saveFile(filePath)
      // Only update the stored path after a successful write
      if (filename) {
        setCurrentPath(filename)
        statusBar.setFilePath(filename)
      }
      setStatusText(`"${filePath}" written`)
    } catch (e) {
      setStatusText(e instanceof Error ? e.message : String(e))
    }
  })

  // Register quit command
  EditorAdapter.commands.quit = (_adapter, _params) => shutdown(0)

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

        if (event.key === "Resize") {
          if (!statusBar.isPrompting()) {
            statusBar.refresh()
          } else {
            focusEditor()
          }
          continue
        }

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
