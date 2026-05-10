import type { IEditorAdapter } from "./adapter-interface"
import { copyCursor, cursorIsBefore, cursorMax, cursorMin, makePos, type Pos } from "./common"
import { expandWordUnderCursor } from "./keymap_vim"
import { findParagraph } from "./motion-paragraph"
import type { VimState } from "./types"
import { lineLength, offsetCursor } from "./vim-utils"

// TODO: perhaps this finagling of start and end positions belongs
// in codemirror/replaceRange?
export function selectCompanionObject(
  adapter: IEditorAdapter,
  head: Pos,
  symb: string,
  inclusive: boolean,
): [Pos, Pos] {
  const cur = head

  const bracketRegexpMatcher: Record<string, RegExp> = {
    "(": /[()]/,
    ")": /[()]/,
    "[": /[[\]]/,
    "]": /[[\]]/,
    "{": /[{}]/,
    "}": /[{}]/,
    "<": /[<>]/,
    ">": /[<>]/,
  }
  const bracketRegexp = bracketRegexpMatcher[symb]
  const openSymMatcher: Record<string, string> = {
    "(": "(",
    ")": "(",
    "[": "[",
    "]": "[",
    "{": "{",
    "}": "{",
    "<": "<",
    ">": "<",
  }
  const openSym = openSymMatcher[symb]
  const curChar = adapter.getLine(cur.line).charAt(cur.ch)
  // Due to the behavior of scanForBracket, we need to add an offset if the
  // cursor is on a matching open bracket.
  const offset = curChar === openSym ? 1 : 0

  const startRes = adapter.scanForBracket(makePos(cur.line, cur.ch + offset), 0, bracketRegexp)
  const endRes = adapter.scanForBracket(makePos(cur.line, cur.ch + offset), 1, bracketRegexp)

  if (!startRes || !endRes) {
    return [cur, cur]
  }

  let start = startRes.pos
  let end = endRes.pos

  if ((start.line === end.line && start.ch > end.ch) || start.line > end.line) {
    const tmp = start
    start = end
    end = tmp
  }

  if (inclusive) {
    end.ch += 1
  } else {
    start.ch += 1
  }

  return [start, end]
}

// Takes in a symbol and a cursor and tries to simulate text objects that
// have identical opening and closing symbols
// TODO support across multiple lines
export function findBeginningAndEnd(adapter: IEditorAdapter, head: Pos, symb: string, inclusive: boolean): [Pos, Pos] {
  const cur = copyCursor(head)
  const line = adapter.getLine(cur.line)
  const chars = line.split("")
  const firstIndex = chars.indexOf(symb)

  let end: number | undefined
  // the decision tree is to always look backwards for the beginning first,
  // but if the cursor is in front of the first instance of the symb,
  // then move the cursor forward
  if (cur.ch < firstIndex) {
    cur.ch = firstIndex
    // Why is this line even here???
    // adapter.setCursor(cur.line, firstIndex+1);
  }
  // otherwise if the cursor is currently on the closing symbol
  else if (firstIndex < cur.ch && chars[cur.ch] === symb) {
    end = cur.ch // assign end to the current cursor
    --cur.ch // make sure to look backwards
  }

  let start: number | undefined

  // if we're currently on the symbol, we've got a start
  if (chars[cur.ch] === symb && !end) {
    start = cur.ch + 1 // assign start to ahead of the cursor
  } else {
    // go backwards to find the start
    for (let i = cur.ch; i > -1 && !start; i--) {
      if (chars[i] === symb) {
        start = i + 1
      }
    }
  }

  // look forwards for the end symbol
  if (start && !end) {
    for (let i = start; i < chars.length && !end; i++) {
      if (chars[i] === symb) {
        end = i
      }
    }
  }

  // nothing found
  if (!start || !end) {
    return [cur, cur]
  }

  // include the symbols
  if (inclusive) {
    --start
    ++end
  }

  return [makePos(cur.line, start), makePos(cur.line, end)]
}

/**
 * Depends on the following:
 *
 * - editor mode should be htmlmixedmode / xml
 * - mode/xml/xml.js should be loaded
 * - addon/fold/xml-fold.js should be loaded
 *
 * If any of the above requirements are not true, this function noops.
 *
 * This is _NOT_ a 100% accurate implementation of vim tag text objects.
 * The following caveats apply (based off cursory testing, I'm sure there
 * are other discrepancies):
 *
 * - Does not work inside comments:
 *   ```
 *   <!-- <div>broken</div> -->
 *   ```
 * - Does not work when tags have different cases:
 *   ```
 *   <div>broken</DIV>
 *   ```
 * - Does not work when cursor is inside a broken tag:
 *   ```
 *   <div><brok><en></div>
 *   ```
 */
export function expandTagUnderCursor(_adapter: IEditorAdapter, head: Pos, _inclusive: boolean): [Pos, Pos] {
  return [head, head]
}

export function expandSelection(adapter: IEditorAdapter, start: Pos, end: Pos): [Pos, Pos] {
  const vim = adapter.state.vim as VimState
  const sel = vim.sel
  let head = sel.head
  let anchor = sel.anchor
  if (cursorIsBefore(end, start)) {
    const tmp = end
    end = start
    start = tmp
  }
  if (cursorIsBefore(head, anchor)) {
    head = cursorMin(start, head)
    anchor = cursorMax(anchor, end)
  } else {
    anchor = cursorMin(start, anchor)
    head = cursorMax(head, end)
    head = offsetCursor(head, 0, -1)
    if (head.ch === -1 && head.line !== adapter.firstLine()) {
      head = makePos(head.line - 1, lineLength(adapter, head.line - 1))
    }
  }
  return [anchor, head]
}

export function motionTextObjectManipulation(
  adapter: IEditorAdapter,
  head: Pos,
  motionArgs: import("./types").MotionArgs,
  vim: VimState,
): Pos | [Pos, Pos] | undefined {
  // TODO: lots of possible exceptions that can be thrown here. Try da(
  //     outside of a () block.
  const mirroredPairs: Record<string, string> = {
    "(": ")",
    ")": "(",
    "{": "}",
    "}": "{",
    "[": "]",
    "]": "[",
    "<": ">",
    ">": "<",
  }
  const selfPaired: Record<string, boolean> = {
    "'": true,
    '"': true,
    "`": true,
  }

  let character = motionArgs.selectedCharacter!
  // 'b' refers to  '()' block.
  // 'B' refers to  '{}' block.
  if (character === "b") {
    character = "("
  } else if (character === "B") {
    character = "{"
  }

  // Inclusive is the difference between a and i
  // TODO: Instead of using the additional text object map to perform text
  //     object operations, merge the map into the defaultKeyMap and use
  //     motionArgs to define behavior. Define separate entries for 'aw',
  //     'iw', 'a[', 'i[', etc.
  const inclusive = !motionArgs.textObjectInner

  let tmp: [Pos, Pos] | undefined
  if (mirroredPairs[character]) {
    tmp = selectCompanionObject(adapter, head, character, inclusive)
  } else if (selfPaired[character]) {
    tmp = findBeginningAndEnd(adapter, head, character, inclusive)
  } else if (character === "W") {
    tmp = expandWordUnderCursor(adapter, inclusive, true /** forward */, true /** bigWord */)
  } else if (character === "w") {
    tmp = expandWordUnderCursor(adapter, inclusive, true /** forward */, false /** bigWord */)
  } else if (character === "p") {
    const para = findParagraph(adapter, head, motionArgs.repeat!, 0, inclusive)
    tmp = Array.isArray(para) ? para : [para, para]
    motionArgs.linewise = true
    if (vim.visualMode) {
      if (!vim.visualLine) {
        vim.visualLine = true
      }
    } else {
      const operatorArgs = vim.inputState.operatorArgs
      if (operatorArgs) {
        operatorArgs.linewise = true
      }
      tmp[1].line--
    }
  } else if (character === "t") {
    tmp = expandTagUnderCursor(adapter, head, inclusive)
  } else {
    // No text object defined for this, don't move.
    return
  }

  if (!tmp) {
    return
  }

  if (!adapter.state.vim.visualMode) {
    return tmp
  } else {
    return expandSelection(adapter, tmp[0], tmp[1])
  }
}
