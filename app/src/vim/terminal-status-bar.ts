import { setStatusText } from "@revim/lib"
import type { IStatusBar, ModeChangeEvent, StatusBarInputOptions, StatusBarKeyEvent } from "./statusbar"

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

  constructor() {
    this.mode = { mode: "normal" }
    // ensure initial text
    this.update()
  }

  private update() {
    const label = modeLabelFor(this.mode)
    const text = this.keyBuffer ? `${label}  ${this.keyBuffer}` : label
    try {
      setStatusText(text)
    } catch (_e) {
      // best-effort; avoid throwing during shutdown
    }
  }

  toggleVisibility(_visible: boolean) {
    // no-op for terminal
  }

  showNotification(_message: string) {
    // no-op for MVP
  }

  setMode(mode: ModeChangeEvent) {
    this.mode = mode
    this.update()
  }

  setKeyBuffer(key: string) {
    this.keyBuffer = key
    this.update()
  }

  startDisplay(_message: string) {
    return () => {}
  }

  isPrompting(): boolean {
    return this.promptState !== null
  }

  handlePromptKey(encodedKey: string): void {
    if (!this.promptState) return
    const state = this.promptState

    const evt = this.decodeKey(encodedKey)
    if (!evt) return

    const close = (value?: string) => {
      if (value !== undefined) {
        state.query = value
        setStatusText(state.prefix + value)
      } else {
        this.promptState = null
        this.update()
      }
    }

    try {
      state.options.onKeyDown?.(evt, state.query, close)
    } catch (_e) {
      // ignore onKeyDown errors to prevent freezing
    }

    if (this.promptState === null) {
      return
    }

    state.query = applyKeyToQuery(evt, state.query)

    setStatusText(state.prefix + state.query)

    try {
      state.options.onKeyUp?.(evt, state.query, close)
    } catch (_e) {
      // ignore onKeyUp errors to prevent freezing
    }

    if (this.promptState === null) {
      return
    }

    if (evt.key === "Enter") {
      // Set promptState = null FIRST to prevent state leak if onClose throws
      this.promptState = null
      this.update()
      state.options.onClose?.(state.query)
    }
  }

  private decodeKey(encodedKey: string): StatusBarKeyEvent | null {
    const stopPropagation = () => {}
    const preventDefault = () => {}

    if (encodedKey.startsWith("'") && encodedKey.endsWith("'") && encodedKey.length === 3) {
      return { key: encodedKey[1], stopPropagation, preventDefault }
    }

    const singleKeyMap: Record<string, string> = {
      Space: " ",
      Enter: "Enter",
      Escape: "Escape",
      Esc: "Escape",
      Backspace: "Backspace",
      Tab: "Tab",
      Delete: "Delete",
      Home: "Home",
      End: "End",
      PageUp: "PageUp",
      PageDown: "PageDown",
      Up: "Up",
      Down: "Down",
      Left: "Left",
      Right: "Right",
    }

    if (singleKeyMap[encodedKey]) {
      return { key: singleKeyMap[encodedKey], stopPropagation, preventDefault }
    }

    const ctrlMatch = encodedKey.match(/^Ctrl-(.+)$/)
    if (ctrlMatch) {
      return { key: ctrlMatch[1], ctrlKey: true, stopPropagation, preventDefault }
    }

    const altMatch = encodedKey.match(/^Alt-(.+)$/)
    if (altMatch) {
      return { key: altMatch[1], altKey: true, stopPropagation, preventDefault }
    }

    const shiftMatch = encodedKey.match(/^Shift-(.+)$/)
    if (shiftMatch) {
      return { key: shiftMatch[1], shiftKey: true, stopPropagation, preventDefault }
    }

    return null
  }

  startPrompt(prefix: string, _desc: string, options: StatusBarInputOptions) {
    this.promptState = { prefix, query: "", options }
    setStatusText(prefix)
    return () => {
      this.promptState = null
      this.update()
    }
  }

  closeInput() {
    // no-op
  }

  clear() {
    // clear internal state
    this.keyBuffer = ""
    this.update()
  }
}

export default TerminalStatusBar
