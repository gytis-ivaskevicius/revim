import { getCurrentPath, getCursorPos } from "@revim/core"
import EditorAdapter, { doNextBuffer, doPrevBuffer } from "./adapter"
import { commands, keyMap } from "@revim/vim"
import { makePos } from "@revim/vim"
import { clearInputState, exitVisualMode, initVimAdapter, vimApi } from "@revim/vim"
import type * as Registers from "@revim/vim"
import type * as StatusBar from "@revim/vim"
import type { VimState } from "@revim/vim"

export type IRegister = Registers.IRegister
export type IStatusBar = StatusBar.IStatusBar
export type ModeChangeEvent = StatusBar.ModeChangeEvent
export type StatusBarInputOptions = StatusBar.StatusBarInputOptions

interface SetOptionConfig {
  append?: boolean
  remove?: boolean
  adapterOption?: boolean
}

export class FileEvent extends Event {
  readonly filename: string

  constructor(type: "open-file" | "save-file", filename: string) {
    super(type)
    this.filename = filename
  }
}

type Listener<T> = (evt: T) => void

interface ListenerObject<T> {
  handleEvent(object: T): void
}

type EventHandler<T> = Listener<T> | ListenerObject<T>

export class VimMode implements EventTarget {
  private statusBar_?: IStatusBar
  private adapter_: EditorAdapter
  private keyBuffer_ = ""
  private attached_ = false
  private listeners_: Map<string, (EventHandler<Event> | EventHandler<FileEvent>)[]> = new Map()
  private closers_ = new Map<string, () => void>()

  constructor(statusBar?: IStatusBar, adapter?: EditorAdapter) {
    this.statusBar_ = statusBar

    initVimAdapter()
    this.adapter_ = adapter ?? new EditorAdapter()

    this.initListeners()
  }

  get adapter() {
    return this.adapter_
  }

  handleKey(key: string) {
    if (this.statusBar_?.isPrompting()) {
      this.statusBar_.handlePromptKey(key)
      return
    }
    const keyMapState = this.adapter_.state.keyMap as string
    const keymap = keyMap[keyMapState]
    const command = keymap?.call?.(key, this.adapter_)

    if (typeof command === "function") {
      const result = command()
      this.updateCursorPos()
      return result
    }
    this.updateCursorPos()
  }

  private updateCursorPos() {
    if (this.statusBar_) {
      const pos = this.adapter_.getCursor()
      this.statusBar_.setCursorPos(pos.line, pos.ch)
    }
  }

  private initListeners() {
    this.adapter_.on("vim-set-clipboard-register", () => {
      this.dispatchEvent(new Event("clipboard"))
    })

    if (this.statusBar_ !== undefined) {
      const statusBar = this.statusBar_

      this.adapter_.on("vim-mode-change", (mode) => {
        statusBar.setMode(mode)
      })

      this.adapter_.on("vim-keypress", (key) => {
        if (key === ":") {
          this.keyBuffer_ = ""
        } else {
          this.keyBuffer_ += key
        }
        statusBar.setKeyBuffer(this.keyBuffer_)
      })

      this.adapter_.on("vim-command-done", () => {
        this.keyBuffer_ = ""
        statusBar.setKeyBuffer(this.keyBuffer_)
      })

      this.adapter_.on("status-display", (msg, id) => {
        const closer = statusBar.startDisplay(msg)
        this.closers_.set(id, closer)
      })

      this.adapter_.on("status-close-display", (id) => {
        const closer = this.closers_.get(id)
        if (closer) {
          closer()
          this.closers_.delete(id)
        }
      })

      this.adapter_.on("status-prompt", (prefix, desc, options, id) => {
        const closer = statusBar.startPrompt(prefix, desc, options)
        this.closers_.set(id, closer)
      })

      this.adapter_.on("status-close-prompt", (id) => {
        const closer = this.closers_.get(id)
        if (closer) {
          closer()
          this.closers_.delete(id)
        }
      })

      this.adapter_.on("status-notify", (msg) => {
        statusBar.showNotification(msg)
      })

      this.adapter_.on("dispose", () => {
        statusBar.toggleVisibility(false)
        statusBar.closeInput()
        statusBar.clear()
      })

      this.adapter_.on("buffer-switch", (path: string | null | undefined) => {
        const vim = this.adapter_.state.vim as VimState | undefined
        if (vim) {
          // Reset Vim mode state on buffer switch
          this.adapter_.enterVimMode() // sets adapter.insertMode = false, calls setVimMode(true)
          vim.insertMode = false
          if (vim.visualMode) {
            exitVisualMode(this.adapter_)
          }
          clearInputState(this.adapter_)
        }
        // Re-sync adapter selection from native state (buffer switch resets anchor=cursor)
        try {
          const pos = getCursorPos()
          const cursor = makePos(pos.line, pos.ch)
          this.adapter_.syncSelection(cursor, cursor)
        } catch (_e) {
          // best-effort
        }
        if (path) {
          statusBar.setFilePath(path)
        } else {
          // If no path, try to get current path from native state
          try {
            const currentPath = getCurrentPath()
            statusBar.setFilePath(currentPath)
          } catch (_e) {
            statusBar.setFilePath(null)
          }
        }
        this.adapter_.dispatch("cursorActivity", this.adapter_)
      })
    }

    commands.open = (_adapter, params) =>
      this.dispatchEvent(new FileEvent("open-file", params.argString || ""))
    commands.save = (_adapter, params) =>
      this.dispatchEvent(new FileEvent("save-file", params.argString || ""))
    commands.nextBuffer = (adapter) => doNextBuffer(adapter)
    commands.prevBuffer = (adapter) => doPrevBuffer(adapter)
  }

  get attached(): boolean {
    return this.attached_
  }

  addEventListener(
    type: "open-file" | "save-file",
    callback: EventHandler<FileEvent>,
    _options?: boolean | AddEventListenerOptions,
  ): void
  addEventListener(type: "clipboard", callback: EventHandler<Event>, _options?: boolean | AddEventListenerOptions): void
  addEventListener(
    type: string,
    callback: EventHandler<Event> | EventHandler<FileEvent>,
    _options?: boolean | AddEventListenerOptions,
  ): void {
    const typeListeners = this.listeners_.get(type)
    if (!typeListeners) {
      if (type === "clipboard") {
      }
      this.listeners_.set(type, [callback])
    } else {
      typeListeners.push(callback)
    }
  }

  dispatchEvent(event: Event): boolean {
    const typeListeners = this.listeners_.get(event.type)
    if (typeListeners) {
      for (const listener of typeListeners) {
        if (Reflect.has(listener, "handleEvent")) {
          ;(listener as EventListenerObject).handleEvent(event)
        } else {
          ;(listener as EventListener)(event)
        }
        if (event.cancelable && event.defaultPrevented) {
          break
        }
      }
    }
    return !(event.cancelable && event.defaultPrevented)
  }

  removeEventListener(
    type: "open-file" | "save-file",
    callback: EventHandler<FileEvent>,
    _options?: boolean | EventListenerOptions,
  ): void
  removeEventListener(type: "clipboard", callback: EventHandler<Event>, _options?: boolean | EventListenerOptions): void
  removeEventListener(
    type: string,
    callback: EventHandler<Event> | EventHandler<FileEvent>,
    _options?: boolean | EventListenerOptions,
  ): void {
    const typeListeners = this.listeners_.get(type)
    if (typeListeners) {
      const index = typeListeners.lastIndexOf(callback)
      if (index >= 0) {
        typeListeners.splice(index, 1)
      }
      if (typeListeners.length === 0) {
        this.listeners_.delete(type)
      }
    }
  }

  enable() {
    if (!this.attached_) {
      this.adapter_.attach()
      this.attached_ = true
    }
  }

  disable() {
    if (this.attached_) {
      this.adapter_.detach()
      this.attached_ = false
    }
  }

  setClipboardRegister(register: IRegister) {
    vimApi.defineRegister("*", register)
    vimApi.defineRegister("+", register)
  }

  executeCommand(input: string) {
    if (!this.attached) {
      throw new Error("Cannot execute commands when not attached")
    }
    vimApi.handleEx(this.adapter_, input)
  }

  setOption(name: string, value: string | number | boolean, config?: SetOptionConfig) {
    if (config?.adapterOption) {
      this.adapter_.setOption(name, value)
    } else {
      vimApi.setOption(name, value, this.adapter_, config)
    }
  }
}

export { EditorAdapter }
export { commands } from "@revim/vim"
