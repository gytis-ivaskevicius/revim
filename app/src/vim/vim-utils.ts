import { CmSelection, isPos, makePos, type Pos } from "@revim/vim-keybindings"
import type EditorAdapter from "./adapter"
import type { VimState } from "./types"

export function lineLength(adapter: EditorAdapter, lineNum: number) {
  return adapter.getLine(lineNum).length
}

export const trim = (s: string) => s.trim()

export const copyArgs = <T>(args: T): T => ({ ...args })

export function offsetCursor(cur: Pos, offsetLine: Pos): Pos
export function offsetCursor(cur: Pos, offsetLine: number, offsetCh: number): Pos
export function offsetCursor(cur: Pos, offsetLine: number | Pos, offsetCh?: number): Pos {
  if (isPos(offsetLine)) {
    return makePos(cur.line + offsetLine.line, cur.ch + offsetLine.ch)
  }
  return makePos(cur.line + offsetLine, cur.ch + offsetCh!)
}

/**
 * Clips cursor to ensure that line is within the buffer's range.
 * If includeLineBreak is true, then allow cur.ch == lineLength.
 */
export function clipCursorToContent(adapter: EditorAdapter, cur: Pos) {
  const vim = adapter.state.vim as VimState
  const includeLineBreak = vim.insertMode || vim.visualMode
  const line = Math.min(Math.max(adapter.firstLine(), cur.line), adapter.lastLine())
  const maxCh = lineLength(adapter, line) - 1 + (includeLineBreak ? 1 : 0)
  const ch = Math.min(Math.max(0, cur.ch), maxCh)
  return makePos(line, ch)
}

export function selectForInsert(adapter: EditorAdapter, head: Pos, height: number) {
  const sel: CmSelection[] = []
  for (let i = 0; i < height; i++) {
    const lineHead = offsetCursor(head, i, 0)
    sel.push(new CmSelection(lineHead, lineHead))
  }
  adapter.setSelections(sel, 0)
}
