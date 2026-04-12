import { setStatusText } from "@revim/lib"
import type { IStatusBar, ModeChangeEvent } from "./statusbar"

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

  startPrompt(_prefix: string, _desc: string, _options: any) {
    return () => {}
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
