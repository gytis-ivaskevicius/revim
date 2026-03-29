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
  posFromIndex,
  pushUndoStop,
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
import { cursorEqual, cursorMax, cursorMin, makePos, type Pos } from "./common"
import type { ModeChangeEvent, StatusBarInputOptions } from "./statusbar"

let _id = 0
const nextId = () => String(++_id)

export class CmSelection {
  readonly anchor: Pos
  readonly head: Pos

  constructor(anchor: Pos, head: Pos) {
    this.anchor = anchor
    this.head = head
  }

  from(): Pos {
    if (this.anchor.line < this.head.line) {
      return this.anchor
    } else if (this.anchor.line === this.head.line) {
      return this.anchor.ch < this.head.ch ? this.anchor : this.head
    } else {
      return this.head
    }
  }

  empty(): boolean {
    return this.anchor.line === this.head.line && this.anchor.ch === this.head.ch
  }
}

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

export interface Change {
  text: string[]
  origin: "+input" | "paste"
  next?: Change
}

interface Operation {
  lastChange?: Change
  change?: Change
  selectionChanged?: boolean
  isVimOp?: boolean
}

interface MatchingBracket {
  symbol: string
  pair: string
  mode: "open" | "close"
  regex: RegExp
}

const kMatchingBrackets: Record<string, MatchingBracket> = {
  "(": { symbol: "(", pair: ")", mode: "close", regex: /[()]/ },
  ")": { symbol: ")", pair: "(", mode: "open", regex: /[()]/ },
  "[": { symbol: "[", pair: "]", mode: "close", regex: /[[\]]/ },
  "]": { symbol: "]", pair: "[", mode: "open", regex: /[[\]]/ },
  "{": { symbol: "{", pair: "}", mode: "close", regex: /[{}]/ },
  "}": { symbol: "}", pair: "{", mode: "open", regex: /[{}]/ },
  "<": { symbol: "<", pair: ">", mode: "close", regex: /[<>]/ },
  ">": { symbol: ">", pair: "<", mode: "open", regex: /[<>]/ },
}

export interface ExCommandOptionalParameters {
  argString?: string
}

export class EditorAdapter {
  static keyMap: Record<string, KeyMapEntry> = {
    default: { find: () => true },
  }
  static commands: Record<string, (adapter: EditorAdapter, params: ExCommandOptionalParameters) => void> = {
    redo: (adapter: EditorAdapter) => {
      adapter.triggerEditorAction("redo")
    },
    undo: (adapter: EditorAdapter) => {
      adapter.triggerEditorAction("undo")
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
    this.pushUndoStop()
  }

  pushUndoStop() {
    pushUndoStop()
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
    const line = this.getLine(cur.line)
    for (let ch = cur.ch; ch < line.length; ch++) {
      const curCh = line.charAt(ch)
      const matchable = kMatchingBrackets[curCh]
      if (matchable) {
        const direction = matchable.mode === "close" ? 1 : -1
        const offset = direction > 0 ? 1 : -1
        return this.scanForBracket(
          makePos(cur.line, ch + offset),
          direction,
          matchable.regex,
          matchable.symbol,
          matchable.pair,
        )
      }
    }
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
    let matchCase = false
    let isRegex = false

    if (pattern instanceof RegExp) {
      matchCase = !pattern.ignoreCase
      isRegex = true
    }

    const query = typeof pattern === "string" ? pattern : pattern.source
    const context = this
    let currentIndex = -1

    const allMatches: { line: number; ch: number; endLine: number; endCh: number }[] = []
    const lineCount = this.lineCount()
    for (let lineIdx = 0; lineIdx < lineCount; lineIdx++) {
      const line = this.getLine(lineIdx)
      const regex = isRegex
        ? new RegExp(query, matchCase ? "g" : "gi")
        : new RegExp(this.escapeRegex(query), matchCase ? "g" : "gi")
      let match: RegExpExecArray | null
      while ((match = regex.exec(line)) !== null) {
        allMatches.push({
          line: lineIdx,
          ch: match.index,
          endLine: lineIdx,
          endCh: match.index + match[0].length,
        })
        if (match[0].length === 0) {
          regex.lastIndex += 1
        }
      }
    }

    return {
      getMatches() {
        return allMatches
      },
      findNext() {
        return this.find(false)
      },
      findPrevious() {
        return this.find(true)
      },
      jumpTo(index: number) {
        if (!allMatches?.length) {
          return false
        }
        currentIndex = Math.max(0, Math.min(index, allMatches.length - 1))
        const match = allMatches[currentIndex]
        return { line: match.line, ch: match.ch }
      },
      find(back: boolean) {
        if (!allMatches?.length) {
          return false
        }

        if (currentIndex === -1) {
          if (back) {
            for (let i = allMatches.length - 1; i >= 0; i--) {
              const match = allMatches[i]
              if (match.line < startPos.line || (match.line === startPos.line && match.ch < startPos.ch)) {
                currentIndex = i
                break
              }
            }
            if (currentIndex === -1) {
              currentIndex = allMatches.length - 1
            }
          } else {
            for (let i = 0; i < allMatches.length; i++) {
              const match = allMatches[i]
              if (match.line > startPos.line || (match.line === startPos.line && match.ch >= startPos.ch)) {
                currentIndex = i
                break
              }
            }
            if (currentIndex === -1) {
              currentIndex = 0
            }
          }
        } else {
          currentIndex = back
            ? (currentIndex - 1 + allMatches.length) % allMatches.length
            : (currentIndex + 1) % allMatches.length
        }

        return currentIndex >= 0
      },
      from() {
        if (currentIndex < 0) {
          return undefined
        }
        const match = allMatches[currentIndex]
        return makePos(match.line, match.ch)
      },
      to() {
        if (currentIndex < 0) {
          return undefined
        }
        const match = allMatches[currentIndex]
        return makePos(match.endLine, match.endCh)
      },
      replace(text: string) {
        const from = this.from()
        const to = this.to()
        if (from && to) {
          context.replaceRange(text, from, to)
        }
      },
    }
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  highlightRanges(
    ranges: Array<{ startLine: number; startCh: number; endLine: number; endCh: number }>,
    _className: string = "findMatch",
  ) {
    setHighlights(ranges)
  }

  addOverlay(query: string | RegExp) {
    const pattern = typeof query === "string" ? new RegExp(this.escapeRegex(query), "g") : query
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
    if (dir === 0) {
      return undefined
    }
    let searchLine = pos.line
    let searchCh = pos.ch
    let depth = 0

    while (true) {
      if (searchLine < 0 || searchLine >= this.lineCount()) {
        return undefined
      }

      const line = this.getLine(searchLine)
      for (let i = searchCh; i >= 0 && i < line.length; i += dir) {
        const curCh = line[i]
        if (!bracketRegex.test(curCh)) {
          continue
        }
        if (openChar && curCh === openChar) {
          depth += 1
          continue
        }
        if (closeChar && curCh === closeChar) {
          if (depth === 0) {
            return { pos: makePos(searchLine, i) }
          }
          depth -= 1
        }
      }

      searchLine += dir
      if (searchLine < 0 || searchLine >= this.lineCount()) {
        return undefined
      }
      searchCh = dir > 0 ? 0 : this.getLine(searchLine).length - 1
    }
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

export default EditorAdapter
