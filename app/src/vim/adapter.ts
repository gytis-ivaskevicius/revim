import {
  clipPos,
  focusEditor,
  getCursorPos,
  getLine,
  getLineCount,
  getLineFirstNonWhitespace,
  getRange,
  getScrollInfo,
  getVisibleLines,
  indentLine,
  indexFromPos,
  pushUndoStop as nativePushUndoStop,
  redo as nativeRedo,
  undo as nativeUndo,
  posFromIndex,
  replaceRange,
  replaceSelections,
  scrollTo,
  scrollToLine,
  setCursorPos,
  setHighlights,
  setSelection as setNativeSelection,
  setReplaceMode,
  setSelection,
  setSelections,
  setVimMode,
  setVisualMode,
  triggerAction,
} from "@revim/lib"
import { log } from "../log"
import { createSearchCursor, escapeRegex, findMatchingBracket, scanForBracket } from "./adapter-search"
import { type Change, CmSelection, type ExCommandOptionalParameters, type Operation } from "./adapter-types"
import { cursorEqual, cursorMax, cursorMin, makePos, type Pos } from "./common"
import type { ModeChangeEvent, StatusBarInputOptions } from "./statusbar"

export type { MatchingBracket, SearchCursor, SearchMatch } from "./adapter-search"
export type { Change, ExCommandOptionalParameters } from "./adapter-types"
// Re-exports for zero-impact on existing import sites
export { CmSelection } from "./adapter-types"

let _id = 0
const nextId = () => String(++_id)

export class Marker implements Pos {
  adapter: EditorAdapter
  id: number
  insertRight: boolean = false
  line: number
  ch: number

  constructor(adapter: EditorAdapter, id: number, line: number, ch: number) {
    this.line = line
    this.ch = ch
    this.adapter = adapter
    this.id = id
    adapter.marks.set(this.id, this)
  }

  clear() {
    this.adapter.marks.delete(this.id)
  }

  find(): Pos {
    return makePos(this.line, this.ch)
  }
}

export type BindingFunction = (adapter: EditorAdapter, next?: KeyMapEntry) => void
type CallFunction = (key: any, adapter: EditorAdapter) => any
type Binding = string | BindingFunction | string[]

export interface KeyMapEntry {
  keys?: Record<string, string>
  find?: (key: string) => boolean
  fallthrough?: string | string[]
  attach?: BindingFunction
  detach?: BindingFunction
  call?: CallFunction
}

export class EditorAdapter {
  static keyMap: Record<string, KeyMapEntry> = {
    default: { find: () => true },
  }
  static commands: Record<string, (adapter: EditorAdapter, params: ExCommandOptionalParameters) => void> = {
    redo: (adapter: EditorAdapter) => {
      adapter.redo()
    },
    undo: (adapter: EditorAdapter) => {
      adapter.undo()
    },
    undoLine: (adapter: EditorAdapter) => {
      adapter.undoLine()
    },
    newlineAndIndent: (adapter: EditorAdapter) => {
      adapter.triggerEditorAction("editor.action.insertLineAfter")
    },
  }

  static lookupKey(
    key: string,
    map: string | KeyMapEntry,
    handle?: (binding: Binding) => boolean,
  ): "nothing" | "multi" | "handled" | undefined {
    if (typeof map === "string") {
      map = EditorAdapter.keyMap[map]
    }

    const found = map.find ? map.find(key) : map.keys ? map.keys[key] : undefined

    if (found === false) return "nothing"
    if (found === "...") return "multi"
    if (found !== null && found !== undefined && handle?.(found as string)) return "handled"

    if (map.fallthrough) {
      if (!Array.isArray(map.fallthrough)) return EditorAdapter.lookupKey(key, map.fallthrough, handle)
      for (let i = 0; i < map.fallthrough.length; i++) {
        const result = EditorAdapter.lookupKey(key, map.fallthrough[i], handle)
        if (result) return result
      }
    }
  }

  state: Record<string, any> = { keyMap: "vim" }
  marks: Map<number, Marker> = new Map()
  uid: number = 0
  listeners: Record<string, ((...args: any) => void)[]> = {}
  curOp: Operation = {}
  attached: boolean = false
  options: any = {}
  insertMode: boolean = true
  replaceMode: boolean = false
  replaceStack: string[] = []
  selectionAnchor: Pos = makePos(0, 0)
  selectionHead: Pos = makePos(0, 0)
  selections: CmSelection[] = [new CmSelection(makePos(0, 0), makePos(0, 0))]
  // Undo/redo is now managed in Rust (per-buffer)
  // See nativePushUndoStop, nativeUndo, nativeRedo

  constructor() {
    const pos = this.readHead()
    this.selectionAnchor = pos
    this.selectionHead = pos
  }

  private readHead(): Pos {
    const pos = getCursorPos()
    return makePos(pos.line, pos.ch)
  }

  private syncSelection(anchor: Pos, head: Pos) {
    this.selectionAnchor = makePos(anchor.line, anchor.ch)
    this.selectionHead = makePos(head.line, head.ch)
    this.selections = [new CmSelection(this.selectionAnchor, this.selectionHead)]
    setSelection(anchor.line, anchor.ch, head.line, head.ch)
  }

  private syncSelections(selections: CmSelection[]) {
    if (!selections.length) {
      return
    }
    this.selections = selections.map(
      (selection) =>
        new CmSelection(
          makePos(selection.anchor.line, selection.anchor.ch),
          makePos(selection.head.line, selection.head.ch),
        ),
    )
    const primary = this.selections[0]
    this.selectionAnchor = makePos(primary.anchor.line, primary.anchor.ch)
    this.selectionHead = makePos(primary.head.line, primary.head.ch)
  }

  dispatch(signal: "status-prompt", prefix: string, desc: string, options: StatusBarInputOptions, id: string): void
  dispatch(signal: "status-close-prompt", id: string): void
  dispatch(signal: "status-display", message: string, id: string): void
  dispatch(signal: "status-close-display", id: string): void
  dispatch(signal: "status-notify", message: string): void
  dispatch(signal: "change", adapter: EditorAdapter, change: Change): void
  dispatch(signal: "cursorActivity", adapter: EditorAdapter): void
  dispatch(signal: "dispose"): void
  dispatch(signal: "vim-command-done", reason?: string): void
  dispatch(signal: "vim-set-clipboard-register"): void
  dispatch(signal: "vim-mode-change", mode: ModeChangeEvent): void
  dispatch(signal: "vim-keypress", key: string): void
  dispatch(signal: "buffer-switch", path: string | null): void
  dispatch(signal: string, ...args: any[]): void {
    const listeners = this.listeners[signal]
    if (!listeners) {
      return
    }

    listeners.forEach((handler) => handler(...args))
  }

  emitVimModeChange(mode: ModeChangeEvent) {
    if (mode.mode === "visual") {
      if (mode.subMode === "blockwise") {
        const cursor = this.getCursor()
        setNativeSelection(cursor.line, cursor.ch, cursor.line, cursor.ch)
      }
      setVisualMode(mode.subMode === "linewise" ? "line" : mode.subMode === "blockwise" ? "block" : "char")
    } else {
      setVisualMode("")
    }

    log(`vim mode: ${mode.mode}`)
    this.dispatch("vim-mode-change", mode)
  }

  on(
    event: "status-prompt",
    handler: (prefix: string, desc: string, options: StatusBarInputOptions, id: string) => void,
  ): void
  on(event: "status-close-prompt", handler: (id: string) => void): void
  on(event: "status-display", handler: (message: string, id: string) => void): void
  on(event: "status-close-display", handler: (id: string) => void): void
  on(event: "status-display" | "status-notify", handler: (message: string) => void): void
  on(event: "cursorActivity", handler: (adapter: EditorAdapter) => void): void
  on(event: "change", handler: (adapter: EditorAdapter, change: Change) => void): void
  on(event: "dispose", handler: () => void): void
  on(event: "vim-command-done", handler: (reason?: string) => void): void
  on(event: "vim-set-clipboard-register", handler: () => void): void
  on(event: "vim-mode-change", handler: (mode: ModeChangeEvent) => void): void
  on(event: "vim-keypress", handler: (key: string) => void): void
  on(event: "buffer-switch", handler: (path: string | null) => void): void
  on(event: string, handler: (...args: any) => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }

    this.listeners[event].push(handler)
  }

  off(event: string, handler: (...args: any) => void) {
    const listeners = this.listeners[event]
    if (!listeners) {
      return
    }

    this.listeners[event] = listeners.filter((l) => l !== handler)
  }

  firstLine() {
    return 0
  }

  lastLine() {
    return this.lineCount() - 1
  }

  lineCount() {
    return getLineCount()
  }

  defaultTextHeight() {
    return 1
  }

  getLine(line: number) {
    if (line < 0) {
      return ""
    }
    const maxLines = this.lineCount()
    if (line >= maxLines) {
      return ""
    }
    return getLine(line)
  }

  getCursor(type: string | null = null) {
    this.selectionHead = this.readHead()

    switch (type) {
      case "anchor":
        return makePos(this.selectionAnchor.line, this.selectionAnchor.ch)
      case "head":
        return makePos(this.selectionHead.line, this.selectionHead.ch)
      case "start":
        return cursorMin(this.selectionAnchor, this.selectionHead)
      case "end":
        return cursorMax(this.selectionAnchor, this.selectionHead)
      default:
        return makePos(this.selectionHead.line, this.selectionHead.ch)
    }
  }

  getRange(start: Pos, end: Pos) {
    return getRange(start.line, start.ch, end.line, end.ch)
  }

  getSelection() {
    const from = cursorMin(this.getCursor("anchor"), this.getCursor("head"))
    const to = cursorMax(this.getCursor("anchor"), this.getCursor("head"))
    return getRange(from.line, from.ch, to.line, to.ch)
  }

  getSelectionRange() {
    return {
      anchor: this.getCursor("anchor"),
      head: this.getCursor("head"),
    }
  }

  replaceRange(text: string, start: Pos, end?: Pos) {
    const endLine = end ? end.line : start.line
    const endCh = end ? end.ch : start.ch
    replaceRange(text, start.line, start.ch, endLine, endCh)
    const head = this.readHead()
    this.syncSelection(head, head)
    this.dispatch("change", this, {
      text: text.split("\n"),
      origin: "+input",
    })
    this.dispatch("cursorActivity", this)
  }

  pushUndoStop() {
    nativePushUndoStop()
  }

  undo() {
    const result = nativeUndo()
    this.syncSelection(makePos(result.line, result.ch), makePos(result.line, result.ch))
    this.dispatch("cursorActivity", this)
  }

  redo() {
    const result = nativeRedo()
    this.syncSelection(makePos(result.line, result.ch), makePos(result.line, result.ch))
    this.dispatch("cursorActivity", this)
  }

  undoLine() {
    // Undo all changes on current line - simplified: just undo
    this.undo()
  }

  setCursor(line: Pos, ch?: number): void
  setCursor(line: number, ch: number): void
  setCursor(line: number | Pos, ch: number) {
    const pos = typeof line === "number" ? makePos(line, ch) : line
    setCursorPos(pos.line, pos.ch)
    this.syncSelection(pos, pos)
  }

  somethingSelected() {
    return !cursorEqual(this.getCursor("anchor"), this.getCursor("head"))
  }

  listSelections(): CmSelection[] {
    return this.selections.map(
      (selection) =>
        new CmSelection(
          makePos(selection.anchor.line, selection.anchor.ch),
          makePos(selection.head.line, selection.head.ch),
        ),
    )
  }

  focus() {
    focusEditor()
  }

  setSelections(selections: CmSelection[], primIndex?: number) {
    const ordered =
      primIndex !== undefined && selections[primIndex]
        ? [selections[primIndex], ...selections.filter((_, index) => index !== primIndex)]
        : selections
    const sels = ordered.map((sel: CmSelection) => {
      return {
        anchorLine: sel.anchor.line,
        anchorCh: sel.anchor.ch,
        headLine: sel.head.line,
        headCh: sel.head.ch,
      }
    })
    setSelections(sels)
    if (ordered[0]) {
      this.syncSelections(ordered)
    }
  }

  setSelection(frm: Pos, to: Pos) {
    setCursorPos(to.line, to.ch)
    this.syncSelection(frm, to)
  }

  getSelections() {
    return this.listSelections().map((selection) =>
      this.getRange(cursorMin(selection.anchor, selection.head), cursorMax(selection.anchor, selection.head)),
    )
  }

  replaceSelections(texts: string[]) {
    replaceSelections(texts)
    const head = this.getCursor("head")
    this.syncSelection(head, head)
    this.dispatch("change", this, {
      text: texts,
      origin: "+input",
    })
    this.dispatch("cursorActivity", this)
  }

  toggleOverwrite(toggle: boolean) {
    this.state.overwrite = toggle
    if (toggle) {
      this.enterVimMode()
      this.replaceMode = true
    } else {
      this.leaveVimMode()
      this.replaceMode = false
      this.replaceStack = []
    }
    setReplaceMode(toggle)
  }

  charCoords(pos: Pos, _mode: string) {
    return {
      top: pos.line,
      left: pos.ch,
    }
  }

  coordsChar(pos: Pos, _mode: string) {
    return pos
  }

  clipPos(p: Pos): Pos {
    const result = clipPos(p.line, p.ch)
    return makePos(result.line, result.ch)
  }

  setBookmark(cursor: Pos, options?: { insertLeft?: boolean }) {
    const bm = new Marker(this, this.uid++, cursor.line, cursor.ch)
    if (!options?.insertLeft) {
      bm.insertRight = true
    }
    return bm
  }

  getScrollInfo() {
    const info = getScrollInfo()
    return { ...info, left: 0 }
  }

  triggerEditorAction(action: string) {
    triggerAction(action)
  }

  dispose() {
    this.dispatch("dispose")
    this.removeOverlay()
    this.detach()
  }

  attach() {
    const vim = EditorAdapter.keyMap.vim
    if (vim?.attach) {
      vim.attach(this)
    }
  }

  detach() {
    const vim = EditorAdapter.keyMap.vim
    if (vim?.detach) {
      vim.detach(this)
    }
  }

  enterVimMode(_toVim = true) {
    this.insertMode = false
    setVimMode(true)
  }

  leaveVimMode() {
    this.insertMode = true
    setVimMode(false)
  }

  getUserVisibleLines() {
    return getVisibleLines()
  }

  findPosV(startPos: Pos, amount: number, unit: "line" | "page") {
    const scrollInfo = this.getScrollInfo()
    switch (unit) {
      case "page":
        return makePos(startPos.line + amount * scrollInfo.clientHeight, startPos.ch)
      case "line":
        return makePos(startPos.line + amount, startPos.ch)
      default:
        return startPos
    }
  }

  findMatchingBracket(cur: Pos) {
    return findMatchingBracket(this, cur)
  }

  findFirstNonWhiteSpaceCharacter(line: number) {
    return getLineFirstNonWhitespace(line)
  }

  scrollTo(x?: number, y?: number) {
    if (x === undefined && y === undefined) {
      return
    }
    if (y !== undefined) {
      scrollTo(y)
    }
  }

  moveCurrentLineTo(viewPosition: "top" | "center" | "bottom") {
    const pos = this.getCursor()
    scrollToLine(pos.line, viewPosition)
  }

  getSearchCursor(pattern: string | RegExp, startPos: Pos) {
    return createSearchCursor(this, pattern, startPos, (text, from, to) => this.replaceRange(text, from, to))
  }

  highlightRanges(
    ranges: Array<{ startLine: number; startCh: number; endLine: number; endCh: number }>,
    _className: string = "findMatch",
  ) {
    setHighlights(ranges)
  }

  addOverlay(query: string | RegExp) {
    const pattern = typeof query === "string" ? new RegExp(escapeRegex(query), "g") : query
    const ranges: Array<{ startLine: number; startCh: number; endLine: number; endCh: number }> = []

    for (let lineIdx = 0; lineIdx < this.lineCount(); lineIdx++) {
      const line = this.getLine(lineIdx)
      const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
      const regex = new RegExp(pattern.source, flags)
      let match: RegExpExecArray | null

      while ((match = regex.exec(line)) !== null) {
        ranges.push({
          startLine: lineIdx,
          startCh: match.index,
          endLine: lineIdx,
          endCh: match.index + match[0].length,
        })
        if (match[0].length === 0) {
          regex.lastIndex += 1
        }
      }
    }

    setHighlights(ranges)
  }

  removeOverlay() {
    setHighlights([])
  }

  scrollIntoView(pos?: Pos, _margin?: number) {
    if (pos) {
      scrollToLine(pos.line, "center")
    }
  }

  moveH(amount: number, units: "char") {
    if (units !== "char") {
      return
    }
    const pos = this.getCursor()
    this.setCursor(makePos(pos.line, pos.ch + amount))
  }

  scanForBracket(
    pos: Pos,
    dir: number,
    bracketRegex: RegExp,
    openChar?: string,
    closeChar?: string,
  ): { pos: Pos } | undefined {
    return scanForBracket(this, pos, dir, bracketRegex, openChar, closeChar)
  }

  indexFromPos(pos: Pos): number {
    return indexFromPos(pos.line, pos.ch)
  }

  posFromIndex(offset: number): Pos {
    const result = posFromIndex(offset)
    return makePos(result.line, result.ch)
  }

  indentLine(line: number, indentRight: boolean = true) {
    indentLine(line, indentRight)
  }

  displayMessage(message: string): () => void {
    const id = nextId()
    this.dispatch("status-display", message, id)
    return () => {
      this.dispatch("status-close-display", id)
    }
  }

  openPrompt(prefix: string, desc: string, options: StatusBarInputOptions): () => void {
    const id = nextId()
    this.dispatch("status-prompt", prefix, desc, options, id)
    return () => {
      this.dispatch("status-close-prompt", id)
    }
  }

  openNotification(message: string) {
    this.dispatch("status-notify", message)
  }

  smartIndent() {
    this.triggerEditorAction("formatSelection")
  }

  moveCursorTo(to: "start" | "end") {
    const pos = this.getCursor()
    const line = this.getLine(pos.line)
    if (to === "start") {
      this.setCursor(makePos(pos.line, 0))
    } else if (to === "end") {
      this.setCursor(makePos(pos.line, line.length))
    }
  }

  execCommand(command: "goLineLeft" | "goLineRight" | "indentAuto") {
    switch (command) {
      case "goLineLeft":
        this.moveCursorTo("start")
        break
      case "goLineRight":
        this.moveCursorTo("end")
        break
      case "indentAuto":
        this.smartIndent()
        break
    }
  }

  setOption(key: string, value: string | number | boolean) {
    this.state[key] = value
    this.options[key] = value
  }

  getOption(key: string): any {
    switch (key) {
      case "readOnly":
        return false
      case "firstLineNumber":
        return this.firstLine() + 1
      case "indentWithTabs":
        return false
      case "tabSize":
        return 2
      default:
        return this.options[key] ?? this.state[key]
    }
  }
}

// Shared helper for dispatching buffer-switch events
// Used by both action handlers and ex commands
export function dispatchBufferSwitch(adapter: EditorAdapter, path: string | null) {
  adapter.dispatch("buffer-switch", path)
}

export default EditorAdapter
