import { setStatusText } from "@revim/lib"
import { log } from "../log"
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
      // best-effort; avoid throwing during shutdown — surface debug info to help
      // when running under tests or during development.
      // eslint-disable-next-line no-console
      console.debug("setStatusText failed", _e)
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
    log(`[search-prompt] 1 START encodedKey: ${encodedKey} promptState: ${!!this.promptState}`)
    if (!this.promptState) {
      log(`[search-prompt] 1b no promptState, returning`)
      return
    }
    const state = this.promptState

    const evt = this.decodeKey(encodedKey)
    log(`[search-prompt] 2 evt: ${evt?.key}`)
    if (!evt) return

    log(`[search-prompt] 3 key: ${encodedKey} evt.key: ${evt.key} query: "${state.query}"`)

    const close = (value?: string) => {
      log(`[search-prompt] close called with value: ${value}`)
      if (value !== undefined) {
      log(`[search-prompt] 1 close called with value: ${value}`)
        state.query = value
        setStatusText(state.prefix + value)
      log(`[search-prompt] 2 close called with value: ${value}`)
      } else {
      log(`[search-prompt] 3 close called with value: ${value}`)
        this.promptState = null
        this.update()
      log(`[search-prompt] 4 close called with value: ${value}`)
      }
    }

    try {
      log(`[search-prompt] 4 calling onKeyDown`)
      state.options.onKeyDown?.(evt, state.query, close)
      log(`[search-prompt] 5 onKeyDown returned`)
    } catch (_e) {
      log(`[search-prompt] onKeyDown error: ${_e}`)
      // ignore onKeyDown errors to prevent freezing
    }

    // For Escape, ensure prompt closes even if onKeyDown threw before calling close()
    if (evt.key === "Escape" && this.promptState !== null) {
      log(`[search-prompt] Escape pressed, closing prompt`)
      close()
      return
    }

    if (this.promptState === null) {
      log(`[search-prompt] 6 promptState is null after onKeyDown, returning`)
      return
    }

    if (evt.key === "Backspace" && state.query.length > 0) {
      state.query = state.query.slice(0, -1)
    } else if (evt.key.length === 1 && !evt.ctrlKey && !evt.altKey && !evt.metaKey) {
      state.query += evt.key
    }

    log(`[search-prompt] 7 setting status text: ${state.prefix + state.query}`)
    setStatusText(state.prefix + state.query)

    // Note: onKeyUp disabled - it was causing issues with findNext moving cursor during typing
    // try {
    //   state.options.onKeyUp?.(evt, state.query, close)
    // } catch (_e) {
    //   // ignore onKeyUp errors
    // }

    if (evt.key === "Enter") {
      log(`[search-prompt] 8 Enter pressed, calling onClose with query: "${state.query}"`)
      // Set promptState = null FIRST to prevent state leak if onClose throws
      this.promptState = null
      this.update()
      log(`[search-prompt] 9 calling onClose`)
      state.options.onClose?.(state.query)
      log(`[search-prompt] 10 onClose returned`)
    }
    log(`[search-prompt] 11 handlePromptKey ending`)
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

    return null
  }

  startPrompt(prefix: string, _desc: string, options: StatusBarInputOptions) {
    log(`[statusbar] startPrompt called with prefix: ${prefix}`)
    this.promptState = { prefix, query: "", options }
    setStatusText(prefix)
    return () => {
      log(`[statusbar] startPrompt closer called`)
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
