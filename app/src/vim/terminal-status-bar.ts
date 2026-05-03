import { setStatusText } from "@revim/lib"
import { TERMINAL_KEY_MAP } from "../terminal-key"
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
  if (evt.key.length === 1 && !evt.ctrlKey && !evt.altKey && !evt.metaKey && !evt.shiftKey) {
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

    const setQuery = (value: string) => {
      state.query = value
      setStatusText(state.prefix + value)
    }

    try {
      const shouldClose = state.options.onKeyDown?.(evt, state.query, setQuery) ?? false
      if (shouldClose) {
        this.promptState = null
        this.update()
      }
    } catch (_e) {
      // ignore onKeyDown errors to prevent freezing
    }

    if (this.promptState === null) {
      return
    }

    state.query = applyKeyToQuery(evt, state.query)

    setStatusText(state.prefix + state.query)

    try {
      state.options.onKeyUp?.(evt, state.query, setQuery)
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
