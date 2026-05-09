/**
 * typedef {Object{line:number,ch:number}} Cursor An object containing the
 *     position of the cursor.
 */

import type { IEditorAdapter } from "./adapter-interface"
import {
  cursorEqual,
  cursorIsBefore,
  cursorIsBetween,
  findFirstNonWhiteSpaceCharacter,
  isLowerCase,
  makePos,
  type Pos,
} from "./common"
import { vimGlobalState } from "./global"
import type { InputState } from "./input-state"
import { getMarkPos } from "./keymap_vim"
import { findParagraph, findSentence } from "./motion-paragraph"
import { motionFindAndSelectNextInclusive, motionFindNext } from "./motion-search"
import { findSymbol } from "./motion-symbols"
import { motionTextObjectManipulation } from "./motion-text-objects"
import { moveToCharacter, moveToWord, recordLastCharacterSearch } from "./motion-word"
import type { MotionArgs, VimState } from "./types"
import { clipCursorToContent } from "./vim-utils"

// All of the functions below return Cursor objects.
export type MotionFunc = (
  adapter: IEditorAdapter,
  head: Pos,
  motionArgs: MotionArgs,
  vim: VimState,
  previousInputState: InputState,
) => MotionResult
type MotionResult = Pos | [Pos, Pos] | undefined
export const motions: Record<string, MotionFunc> = {
  moveToTopLine: (adapter, _head, motionArgs) => {
    const line = getUserVisibleLines(adapter).top + motionArgs.repeat! - 1
    return makePos(line, findFirstNonWhiteSpaceCharacter(adapter.getLine(line)))
  },
  moveToMiddleLine: (adapter) => {
    const range = getUserVisibleLines(adapter)
    const line = Math.floor((range.top + range.bottom) * 0.5)
    return makePos(line, findFirstNonWhiteSpaceCharacter(adapter.getLine(line)))
  },
  moveToBottomLine: (adapter, _head, motionArgs) => {
    const line = getUserVisibleLines(adapter).bottom - motionArgs.repeat! + 1
    return makePos(line, findFirstNonWhiteSpaceCharacter(adapter.getLine(line)))
  },
  expandToLine: (_cm, head, motionArgs) => {
    // Expands forward to end of line, and then to next line if repeat is
    // >1. Does not handle backward motion!
    return makePos(head.line + motionArgs.repeat! - 1, Infinity)
  },
  findNext: (adapter, head, motionArgs) => motionFindNext(adapter, head, motionArgs),
  findAndSelectNextInclusive: (adapter, head, motionArgs, vim, prevInputState) =>
    motionFindAndSelectNextInclusive(adapter, head, motionArgs, vim, prevInputState),
  goToMark: (adapter, _head, motionArgs, vim) => {
    const pos = getMarkPos(adapter, vim!, motionArgs.selectedCharacter!)
    if (pos) {
      return motionArgs.linewise ? makePos(pos.line, findFirstNonWhiteSpaceCharacter(adapter.getLine(pos.line))) : pos
    }
    return
  },
  moveToOtherHighlightedEnd: (adapter, _head, motionArgs, vim) => {
    if (!vim) {
      return
    }
    if (vim.visualBlock && motionArgs.sameLine) {
      const sel = vim.sel
      return [
        clipCursorToContent(adapter, makePos(sel.anchor.line, sel.head.ch)),
        clipCursorToContent(adapter, makePos(sel.head.line, sel.anchor.ch)),
      ]
    } else {
      return [vim.sel.head, vim.sel.anchor]
    }
  },
  jumpToMark: (adapter, head, motionArgs, vim) => {
    if (!vim) {
      return
    }
    let best = head
    for (let i = 0; i < motionArgs.repeat!; i++) {
      const cursor = best
      for (const key in vim.marks) {
        if (!isLowerCase(key)) {
          continue
        }
        const mark = vim.marks[key].find()
        const isWrongDirection = motionArgs.forward ? cursorIsBefore(mark, cursor) : cursorIsBefore(cursor, mark)

        if (isWrongDirection) {
          continue
        }
        if (motionArgs.linewise && mark.line === cursor.line) {
          continue
        }

        const equal = cursorEqual(cursor, best)
        const between = motionArgs.forward ? cursorIsBetween(cursor, mark, best) : cursorIsBetween(best, mark, cursor)

        if (equal || between) {
          best = mark
        }
      }
    }

    if (motionArgs.linewise) {
      // Vim places the cursor on the first non-whitespace character of
      // the line if there is one, else it places the cursor at the end
      // of the line, regardless of whether a mark was found.
      best = makePos(best.line, findFirstNonWhiteSpaceCharacter(adapter.getLine(best.line)))
    }
    return best
  },
  moveByCharacters: (_cm, head, motionArgs) => {
    const cur = head
    const repeat = motionArgs.repeat || 0
    const ch = motionArgs.forward ? cur.ch + repeat : cur.ch - repeat
    return makePos(cur.line, ch)
  },
  moveByLines: function (adapter, head, motionArgs, vim, prevInputState) {
    const cur = head
    let endCh = cur.ch
    // Depending what our last motion was, we may want to do different
    // things. If our last motion was moving vertically, we want to
    // preserve the HPos from our last horizontal move.  If our last motion
    // was going to the end of a line, moving vertically we should go to
    // the end of the line, etc.
    switch (vim.lastMotion) {
      case this.moveByLines:
      case this.moveByDisplayLines:
      case this.moveByScroll:
      case this.moveToColumn:
      case this.moveToEol:
        endCh = vim.lastHPos
        break
      default:
        vim.lastHPos = endCh
    }
    const repeat = (motionArgs.repeat || 0) + (motionArgs.repeatOffset || 0)
    let line = motionArgs.forward ? cur.line + repeat : cur.line - repeat
    const first = adapter.firstLine()
    const last = adapter.lastLine()
    const posV = adapter.findPosV(
      cur,
      motionArgs.forward ? repeat : -repeat,
      "line",
      // vim.lastHSPos
    )
    const hasMarkedText = motionArgs.forward ? posV.line > line : posV.line < line
    if (hasMarkedText) {
      line = posV.line
      endCh = vim.visualBlock ? vim.lastHPos : posV.ch
    }
    if (vim.visualBlock && !Number.isFinite(posV.ch)) {
      endCh = vim.lastHPos
    }
    // Vim go to line begin or line end when cursor at first/last line and
    // move to previous/next line is triggered.
    if (line < first && cur.line === first) {
      return this.moveToStartOfLine(adapter, head, motionArgs, vim, prevInputState)
    } else if (line > last && cur.line === last) {
      return moveToEol(adapter, head, motionArgs, vim, true)
    }
    if (motionArgs.toFirstChar) {
      endCh = findFirstNonWhiteSpaceCharacter(adapter.getLine(line))
      vim.lastHPos = endCh
    } else if (vim.visualBlock) {
      endCh = vim.lastHPos
    }
    vim.lastHSPos = adapter.charCoords(makePos(line, endCh), "div").left
    return makePos(line, endCh)
  },
  moveByDisplayLines: function (adapter, head, motionArgs, vim) {
    const cur = head
    switch (vim.lastMotion) {
      case this.moveByDisplayLines:
      case this.moveByScroll:
      case this.moveByLines:
      case this.moveToColumn:
      case this.moveToEol:
        break
      default:
        vim.lastHSPos = adapter.charCoords(cur, "div").left
    }
    const repeat = motionArgs.repeat || 0
    const res = adapter.findPosV(
      cur,
      motionArgs.forward ? repeat : -repeat,
      "line",
      // vim.lastHSPos
    )
    vim.lastHPos = res.ch
    return res
  },
  moveByPage: (adapter, head, motionArgs) => {
    // IEditorAdapter only exposes functions that move the cursor page down, so
    // doing this bad hack to move the cursor and move it back. evalInput
    // will move the cursor to where it should be in the end.
    const curStart = head
    const repeat = motionArgs.repeat!
    return adapter.findPosV(curStart, motionArgs.forward ? repeat : -repeat, "page")
  },
  moveByParagraph: (adapter, head, motionArgs) => {
    const dir = motionArgs.forward ? 1 : -1
    return findParagraph(adapter, head, motionArgs.repeat!, dir)
  },
  moveBySentence: (adapter, head, motionArgs) => {
    const dir = motionArgs.forward ? 1 : -1
    return findSentence(adapter, head, motionArgs.repeat!, dir)
  },
  moveByScroll: (adapter, head, motionArgs, vim, prevInputState) => {
    const scrollbox = adapter.getScrollInfo()
    let repeat = motionArgs.repeat
    if (!repeat) {
      repeat = scrollbox.clientHeight / (2 * adapter.defaultTextHeight())
    }
    const orig = adapter.charCoords(head, "local")
    motionArgs.repeat = repeat
    const curEnd = motions.moveByDisplayLines(adapter, head, motionArgs, vim, prevInputState)
    if (!curEnd) {
      return
    }
    const dest = adapter.charCoords(curEnd as Pos, "local")
    adapter.scrollTo(undefined, scrollbox.top + dest.top - orig.top)
    return curEnd
  },
  moveByWords: (adapter, head, motionArgs) =>
    moveToWord(adapter, head, motionArgs.repeat!, !!motionArgs.forward, !!motionArgs.wordEnd, !!motionArgs.bigWord),
  moveTillCharacter: (adapter, _head, motionArgs) => {
    const repeat = motionArgs.repeat || 0
    const curEnd = moveToCharacter(adapter, repeat, !!motionArgs.forward, motionArgs.selectedCharacter!)
    const increment = motionArgs.forward ? -1 : 1
    recordLastCharacterSearch(increment, motionArgs)
    if (!curEnd) return
    curEnd.ch += increment
    return curEnd
  },
  moveToCharacter: (adapter, head, motionArgs) => {
    const repeat = motionArgs.repeat || 0
    recordLastCharacterSearch(0, motionArgs)
    return moveToCharacter(adapter, repeat, !!motionArgs.forward, motionArgs.selectedCharacter!) || head
  },
  moveToSymbol: (adapter, head, motionArgs) => {
    const repeat = motionArgs.repeat || 0
    return findSymbol(adapter, repeat, !!motionArgs.forward, motionArgs.selectedCharacter!) || head
  },
  moveToColumn: (adapter, head, motionArgs, vim) => {
    const repeat = motionArgs.repeat || 0
    // repeat is equivalent to which column we want to move to!
    vim.lastHPos = repeat - 1
    vim.lastHSPos = adapter.charCoords(head, "div").left
    return moveToColumn(adapter, repeat)
  },
  moveToEol: (adapter, head, motionArgs, vim) => moveToEol(adapter, head, motionArgs, vim, false),
  moveToFirstNonWhiteSpaceCharacter: (adapter, head) => {
    // Go to the start of the line where the text begins, or the end for
    // whitespace-only lines
    const cursor = head
    return makePos(cursor.line, findFirstNonWhiteSpaceCharacter(adapter.getLine(cursor.line)))
  },
  moveToMatchedSymbol: (adapter, head) => {
    const lineText = adapter.getLine(head.line)
    if (head.ch < lineText.length) {
      const matched = adapter.findMatchingBracket(head)
      if (matched) {
        return matched.pos
      }
    } else {
      return head
    }
  },
  moveToStartOfLine: (_cm, head) => makePos(head.line, 0),
  moveToLineOrEdgeOfDocument: (adapter, _head, motionArgs) => {
    let lineNum = motionArgs.forward ? adapter.lastLine() : adapter.firstLine()
    if (motionArgs.repeatIsExplicit) {
      lineNum = motionArgs.repeat! - adapter.getOption("firstLineNumber")
    }
    return makePos(lineNum, findFirstNonWhiteSpaceCharacter(adapter.getLine(lineNum)))
  },
  moveToStartOfDisplayLine: (adapter) => {
    adapter.execCommand("goLineLeft")
    return adapter.getCursor()
  },
  moveToEndOfDisplayLine: (adapter) => {
    adapter.execCommand("goLineRight")
    return adapter.getCursor()
  },
  textObjectManipulation: (adapter, head, motionArgs, vim) =>
    motionTextObjectManipulation(adapter, head, motionArgs, vim),
  repeatLastCharacterSearch: (adapter, head, motionArgs) => {
    const lastSearch = vimGlobalState.lastCharacterSearch
    const repeat = motionArgs.repeat || 0
    const forward = motionArgs.forward === lastSearch.forward
    const increment = (lastSearch.increment ? 1 : 0) * (forward ? -1 : 1)
    adapter.moveH(-increment, "char")
    motionArgs.inclusive = !!forward
    const curEnd = moveToCharacter(adapter, repeat, forward, lastSearch.selectedCharacter)
    if (!curEnd) {
      adapter.moveH(increment, "char")
      return head
    }
    curEnd.ch += increment
    return curEnd
  },
}

export const defineMotion = (name: string, fn: MotionFunc) => (motions[name] = fn)

function getUserVisibleLines(adapter: IEditorAdapter) {
  const scrollInfo = adapter.getScrollInfo()
  const occludeToleranceTop = 6
  const occludeToleranceBottom = 10
  const from: Pos = { ch: 0, line: occludeToleranceTop + scrollInfo.top }
  const bottomY = scrollInfo.clientHeight - occludeToleranceBottom + scrollInfo.top
  const to: Pos = { ch: 0, line: bottomY }
  return { top: from.line, bottom: to.line }
}

function moveToEol(adapter: IEditorAdapter, head: Pos, motionArgs: MotionArgs, vim: VimState, keepHPos: boolean) {
  const cur = head
  const retval = makePos(cur.line + motionArgs.repeat! - 1, Infinity)
  const end = adapter.clipPos(retval)
  end.ch--
  if (!keepHPos) {
    vim.lastHPos = Infinity
    vim.lastHSPos = adapter.charCoords(end, "div").left
  }
  return retval
}

function moveToColumn(adapter: IEditorAdapter, repeat: number) {
  // repeat is always >= 1, so repeat - 1 always corresponds
  // to the column we want to go to.
  const line = adapter.getCursor().line
  return clipCursorToContent(adapter, makePos(line, repeat - 1))
}
