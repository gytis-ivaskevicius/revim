import type EditorAdapter from "./adapter"
import { cursorEqual, makePos, type Pos } from "./common"
import type { InputState } from "./input-state"
import { getSearchState } from "./search"
import { findNext, highlightSearchMatches } from "./search-utils"
import type { MotionArgs, VimState } from "./types"
import { log } from "../log"

export function motionFindNext(adapter: EditorAdapter, _head: Pos, motionArgs: MotionArgs): Pos | undefined {
  const state = getSearchState(adapter)
  if (!state) return
  const query = state.getQuery()
  if (!query) {
    log(`[motionFindNext] no query found`)
    return
  }
  let prev = !motionArgs.forward
  log(`[motionFindNext] motionArgs.forward: ${motionArgs.forward} initial prev: ${prev}`)
  // If search is initiated with ? instead of /, negate direction.
  prev = state.isReversed() ? !prev : prev
  log(`[motionFindNext] isReversed: ${state.isReversed()} final prev: ${prev} query: ${query}`)
  highlightSearchMatches(adapter, query)
  const result = findNext(adapter, prev /** prev */, query, motionArgs.repeat)
  log(`[motionFindNext] result: ${JSON.stringify(result)}`)
  return result
}

/**
 * Pretty much the same as `findNext`, except for the following differences:
 *
 * 1. Before starting the search, move to the previous search. This way if our cursor is
 * already inside a match, we should return the current match.
 * 2. Rather than only returning the cursor's from, we return the cursor's from and to as a tuple.
 */
function findNextFromAndToInclusive(
  adapter: EditorAdapter,
  prev: boolean,
  query: RegExp,
  repeat: number,
  vim: VimState,
): [Pos, Pos] | undefined {
  if (repeat === undefined) {
    repeat = 1
  }
  const pos = adapter.getCursor()
  let cursor = adapter.getSearchCursor(query, pos)

  // Go back one result to ensure that if the cursor is currently a match, we keep it.
  let found = cursor.find(!prev)

  // If we haven't moved, go back one more (similar to if i==0 logic in findNext).
  const initialFrom = cursor.from()
  if (!vim.visualMode && found && initialFrom && cursorEqual(initialFrom, pos)) {
    cursor.find(!prev)
  }

  for (let i = 0; i < repeat; i++) {
    found = cursor.find(prev)
    if (!found) {
      // SearchCursor may have returned null because it hit EOF, wrap
      // around and try again.
      cursor = adapter.getSearchCursor(query, makePos(prev ? adapter.lastLine() : adapter.firstLine(), 0))
      if (!cursor.find(prev)) {
        return
      }
    }
  }
  const from = cursor.from()
  const to = cursor.to()
  if (!from || !to) {
    return
  }
  return [from, to]
}

/**
 * Find and select the next occurrence of the search query. If the cursor is currently
 * within a match, then find and select the current match. Otherwise, find the next occurrence in the
 * appropriate direction.
 *
 * This differs from `findNext` in the following ways:
 *
 * 1. Instead of only returning the "from", this returns a "from", "to" range.
 * 2. If the cursor is currently inside a search match, this selects the current match
 *    instead of the next match.
 * 3. If there is no associated operator, this will turn on visual mode.
 */
export function motionFindAndSelectNextInclusive(
  adapter: EditorAdapter,
  _head: Pos,
  motionArgs: MotionArgs,
  vim: VimState,
  prevInputState: InputState,
): Pos | [Pos, Pos] | undefined {
  const state = getSearchState(adapter)
  if (!state) return
  const query = state.getQuery()

  if (!query || !vim) {
    return
  }

  let prev = !motionArgs.forward
  prev = state.isReversed() ? !prev : prev

  // next: [from, to] | null
  const next = findNextFromAndToInclusive(adapter, prev, query, motionArgs.repeat!, vim)

  // No matches.
  if (!next || !vim) {
    return
  }

  // If there's an operator that will be executed, return the selection.
  if (prevInputState?.operator) {
    return next
  }

  // At this point, we know that there is no accompanying operator -- let's
  // deal with visual mode in order to select an appropriate match.

  const from = next[0]
  // For whatever reason, when we use the "to" as returned by searchcursor.js directly,
  // the resulting selection is extended by 1 char. Let's shrink it so that only the
  // match is selected.
  const to = makePos(next[1].line, next[1].ch - 1)

  if (vim.visualMode) {
    // If we were in visualLine or visualBlock mode, get out of it.
    if (vim.visualLine || vim.visualBlock) {
      vim.visualLine = false
      vim.visualBlock = false
      adapter.emitVimModeChange({
        mode: "visual",
        subMode: "",
      })
    }

    // If we're currently in visual mode, we should extend the selection to include
    // the search result.
    const anchor = vim.sel.anchor
    if (anchor) {
      if (state.isReversed()) {
        if (motionArgs.forward) {
          return [anchor, from]
        }

        return [anchor, to]
      } else {
        if (motionArgs.forward) {
          return [anchor, to]
        }

        return [anchor, from]
      }
    }
  } else {
    // Let's turn visual mode on.
    vim.visualMode = true
    vim.visualLine = false
    vim.visualBlock = false
    adapter.emitVimModeChange({
      mode: "visual",
      subMode: "",
    })
  }

  return prev ? [to, from] : [from, to]
}
