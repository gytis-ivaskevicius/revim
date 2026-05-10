import path from "node:path"
import { focusEditor, getCurrentPath, getCursorPos, getTerminalWidth, setStatusText } from "@revim/core"
import type { IStatusBar, ModeChangeEvent, StatusBarInputOptions, StatusBarKeyEvent } from "@revim/vim"
import { TERMINAL_KEY_MAP } from "../terminal-key"

function modeLabelFor(event: ModeChangeEvent | undefined): string {
  if (!event) return "NORMAL"
  switch (event.mode) {
    case "insert":
      return "INSERT"
    case "visual":
      if (event.subMode === "linewise") return "V-LINE"
      if (event.subMode === "blockwise") return "V-BLOCK"
      return "VISUAL"
    case "replace":
      return "REPLACE"
    default:
      return "NORMAL"
  }
}

export function applyKeyToQuery(evt: StatusBarKeyEvent, query: string): string {
  if (evt.key === "Backspace" && query.length > 0) {
    return query.slice(0, -1)
  }
  if (evt.key.length === 1 && !evt.ctrlKey && !evt.altKey && !evt.metaKey) {
    return query + evt.key
  }
  return query
}

export class TerminalStatusBar implements IStatusBar {
  private mode: ModeChangeEvent | undefined
  private keyBuffer = ""
  private promptState: {
    prefix: string
    query: string
    options: StatusBarInputOptions
  } | null = null
  // Array of display entries. Each entry is an object (not a plain string) to
  // provide stable reference identity for the indexOf-based removal in closers.
  private displayState: { message: string }[] = []
  private notificationTimeout: ReturnType<typeof setTimeout> | null = null
  private filePath: string | null = null

  constructor() {
    this.mode = { mode: "normal" }
    try {
      const p = getCurrentPath()
      this.filePath = p
    } catch (_e) {
      // best-effort
    }
    // ensure initial text
    this.update()
  }

  private clearNotificationTimeout() {
    if (this.notificationTimeout !== null) {
      clearTimeout(this.notificationTimeout)
      this.notificationTimeout = null
    }
  }

  private update() {
    try {
      // Priority order: prompt > notification > display > mode+buffer+filename+line:col

      // If prompting, prompt manages its own text via setStatusText
      if (this.promptState) return

      // If notification is active, don't overwrite it
      if (this.notificationTimeout !== null) return

      // If display message is active, show the latest one
      if (this.displayState.length > 0) {
        setStatusText(this.displayState[this.displayState.length - 1].message)
        return
      }

      // Compose mode + buffer + filename + line:col
      const label = modeLabelFor(this.mode)
      const keyPart = this.keyBuffer ? `  ${this.keyBuffer}` : ""
      const filename = this.getFilename()
      const leftSection = `${label}${keyPart}  ${filename}`
      const pos = getCursorPos()
      const rightSection = `${pos.line + 1}:${pos.ch + 1}`

      let terminalWidth: number
      try {
        terminalWidth = getTerminalWidth()
      } catch (_e) {
        terminalWidth = 80
      }

      // Right-align line:col with padding
      const paddingNeeded = terminalWidth - leftSection.length - rightSection.length

      if (paddingNeeded >= 0) {
        const paddedRight = " ".repeat(paddingNeeded) + rightSection
        setStatusText(leftSection + paddedRight)
      } else if (terminalWidth > leftSection.length) {
        // Truncate right section from the left to fit
        const availableForRight = terminalWidth - leftSection.length
        const truncatedRight = rightSection.slice(rightSection.length - availableForRight)
        setStatusText(leftSection + truncatedRight)
      } else {
        // Terminal too narrow, just show left section truncated
        setStatusText(leftSection.slice(0, terminalWidth))
      }
    } catch (_e) {
      // best-effort; avoid throwing during shutdown
    }
  }

  toggleVisibility(_visible: boolean) {
    // no-op for terminal
  }

  showNotification(message: string) {
    this.clearNotificationTimeout()
    // Clear any active display message (notification overrides display permanently)
    this.displayState = []
    try {
      setStatusText(message)
      focusEditor()
    } catch (_e) {
      // best-effort
    }
    this.notificationTimeout = setTimeout(() => {
      this.notificationTimeout = null
      this.update()
      try {
        focusEditor()
      } catch (_e) {
        // best-effort
      }
    }, 3000)
  }

  setMode(mode: ModeChangeEvent) {
    this.mode = mode
    this.clearNotificationTimeout()
    this.update()
  }

  setKeyBuffer(key: string) {
    this.keyBuffer = key
    this.clearNotificationTimeout()
    this.update()
  }

  setCursorPos(_line: number, _col: number) {
    this.update()
  }

  setFilePath(path: string | null) {
    this.filePath = path
    this.update()
  }

  startDisplay(message: string): () => void {
    const entry = { message }
    this.displayState.push(entry)
    try {
      setStatusText(message)
      focusEditor()
    } catch (_e) {
      // best-effort
    }
    const closer = () => {
      const idx = this.displayState.indexOf(entry)
      if (idx >= 0) this.displayState.splice(idx, 1)
      this.update()
      try {
        focusEditor()
      } catch (_e) {
        // best-effort
      }
    }
    return closer
  }

  private getFilename(): string {
    if (!this.filePath) return "[No Name]"
    return path.basename(this.filePath) || "[No Name]"
  }

  isPrompting(): boolean {
    return this.promptState !== null
  }

  handlePromptKey(encodedKey: string): void {
    if (!this.promptState) return
    const state = this.promptState

    const evt = this.decodeKey(encodedKey)
    if (!evt) return

    const setQuery = (value: string) => {
      state.query = value
      setStatusText(state.prefix + value)
    }

    try {
      const shouldClose = state.options.onKeyDown?.(evt, state.query, setQuery) ?? false
      if (shouldClose) {
        this.promptState = null
        this.update()
        if (evt.key === "Enter") {
          state.options.onClose?.(state.query)
        }
        return
      }
    } catch (_e) {
      // ignore onKeyDown errors to prevent freezing
    }

    state.query = applyKeyToQuery(evt, state.query)

    setStatusText(state.prefix + state.query)

    try {
      state.options.onKeyUp?.(evt, state.query, setQuery)
    } catch (_e) {
      // ignore onKeyUp errors to prevent freezing
    }
  }

  private decodeKey(encodedKey: string): StatusBarKeyEvent | null {
    const stopPropagation = () => {}
    const preventDefault = () => {}

    if (encodedKey.startsWith("'") && encodedKey.endsWith("'") && encodedKey.length === 3) {
      return { key: encodedKey[1], stopPropagation, preventDefault }
    }

    // Check exact match in TERMINAL_KEY_MAP first (handles named keys like Enter, Space, Insert, etc.)
    const mappedKey = TERMINAL_KEY_MAP[encodedKey]
    if (mappedKey !== undefined) {
      return { key: mappedKey, stopPropagation, preventDefault }
    }

    // Strip modifier prefixes compound-aware: supports Shift-Ctrl-A, Ctrl-Shift-A, Alt-Ctrl-a, etc.
    let key = encodedKey
    let ctrlKey = false
    let altKey = false
    let shiftKey = false

    const modifierPattern = /^(Ctrl|Alt|Shift)-(.+)$/
    let match: RegExpMatchArray | null
    while ((match = key.match(modifierPattern))) {
      const prefix = match[1]
      key = match[2]
      if (prefix === "Ctrl") ctrlKey = true
      else if (prefix === "Alt") altKey = true
      else if (prefix === "Shift") shiftKey = true
    }

    if (ctrlKey || altKey || shiftKey) {
      return { key, ctrlKey, altKey, shiftKey, stopPropagation, preventDefault }
    }

    return null
  }

  startPrompt(prefix: string, _desc: string, options: StatusBarInputOptions) {
    // Clear any active display message (prompt overrides display permanently)
    this.displayState = []
    this.promptState = { prefix, query: "", options }
    try {
      setStatusText(prefix)
      focusEditor()
    } catch (_e) {
      // best-effort
    }
    return () => {
      this.promptState = null
      this.update()
      try {
        focusEditor()
      } catch (_e) {
        // best-effort
      }
    }
  }

  closeInput() {
    // no-op
  }

  refresh() {
    this.update()
  }

  clear() {
    // clear internal state
    this.keyBuffer = ""
    this.clearNotificationTimeout()
    this.update()
  }
}

export default TerminalStatusBar
