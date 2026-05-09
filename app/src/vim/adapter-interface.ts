import type { Change, CmSelection, ExCommandOptionalParameters, Operation } from "./adapter-types"
import type { SearchCursor } from "./adapter-search"
import type { Pos } from "./common"
import type { ModeChangeEvent, StatusBarInputOptions } from "./statusbar"

export type BindingFunction = (adapter: IEditorAdapter, next?: KeyMapEntry) => void
export type CallFunction = (key: any, adapter: IEditorAdapter) => any
export type Binding = string | BindingFunction | string[]

export interface KeyMapEntry {
  keys?: Record<string, string>
  find?: (key: string) => boolean
  fallthrough?: string | string[]
  attach?: BindingFunction
  detach?: BindingFunction
  call?: CallFunction
}

export interface IMarker extends Pos {
  id: number
  insertRight: boolean
  clear(): void
  find(): Pos
}

export interface IEditorAdapter {
  state: Record<string, any>
  curOp: Operation
  attached: boolean
  marks: Map<number, IMarker>

  // Navigation
  firstLine(): number
  lastLine(): number
  lineCount(): number
  getCursor(type?: string | null): Pos
  setCursor(line: number | Pos, ch?: number): void
  clipPos(p: Pos): Pos
  indexFromPos(pos: Pos): number
  posFromIndex(offset: number): Pos

  // Content
  getLine(line: number): string
  getRange(start: Pos, end: Pos): string

  // Editing
  replaceRange(text: string, start: Pos, end?: Pos): void
  replaceSelections(texts: string[]): void
  pushUndoStop(): void
  undo(): void
  redo(): void
  undoLine(): void
  toggleOverwrite(toggle: boolean): void
  indentLine(line: number, indentRight?: boolean): void
  moveH(amount: number, units: "char"): void
  execCommand(command: "goLineLeft" | "goLineRight" | "indentAuto"): void
  triggerEditorAction(action: string): void
  smartIndent(): void

  // Selection
  somethingSelected(): boolean
  getSelection(): string
  getSelections(): string[]
  getSelectionRange(): { anchor: Pos; head: Pos }
  listSelections(): CmSelection[]
  setSelection(from: Pos, to: Pos): void
  setSelections(selections: CmSelection[], primIndex?: number): void

  // Scroll & layout
  getScrollInfo(): { top: number; clientHeight: number; left: number }
  scrollTo(x?: number, y?: number): void
  scrollIntoView(pos?: Pos, margin?: number): void
  moveCurrentLineTo(viewPosition: "top" | "center" | "bottom"): void
  findPosV(startPos: Pos, amount: number, unit: "line" | "page"): Pos
  charCoords(pos: Pos, mode: string): { top: number; left: number }
  coordsChar(pos: Pos, mode: string): Pos
  defaultTextHeight(): number

  // Search & brackets
  getSearchCursor(pattern: string | RegExp, startPos: Pos): SearchCursor
  findMatchingBracket(cur: Pos): { pos: Pos } | undefined
  findFirstNonWhiteSpaceCharacter(line: number): number
  scanForBracket(pos: Pos, dir: number, bracketRegex: RegExp, openChar?: string, closeChar?: string): { pos: Pos } | undefined

  // Highlights
  addOverlay(query: string | RegExp): void
  removeOverlay(): void

  // Bookmarks
  setBookmark(cursor: Pos, options?: { insertLeft?: boolean }): IMarker

  // Mode
  enterVimMode(toVim?: boolean): void
  leaveVimMode(): void
  emitVimModeChange(mode: ModeChangeEvent): void

  // Focus
  focus(): void

  // Options
  setOption(key: string, value: string | number | boolean): void
  getOption(key: string): any

  // UI
  displayMessage(message: string): () => void
  openPrompt(prefix: string, desc: string, options: StatusBarInputOptions): () => void
  openNotification(message: string): void

  // Events
  dispatch(signal: string, ...args: any[]): void
  on(event: string, handler: (...args: any) => void): void
  off(event: string, handler: (...args: any) => void): void

  log(...args: unknown[]): void
}
