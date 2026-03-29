import type EditorAdapter from "./adapter"
import { copyCursor, makePos, type Pos } from "./common"
import { vimGlobalState } from "./global"
import { bigWordCharTest, keywordCharTest } from "./keymap_vim"
import type { MotionArgs } from "./types"
import { lineLength } from "./vim-utils"

/**
 * @param {EditorAdapter} adapter EditorAdapter object.
 * @param {Pos} cur The position to start from.
 * @param {int} repeat Number of words to move past.
 * @param {boolean} forward True to search forward. False to search
 *     backward.
 * @param {boolean} wordEnd True to move to end of word. False to move to
 *     beginning of word.
 * @param {boolean} bigWord True if punctuation count as part of the word.
 *     False if only alphabet characters count as part of the word.
 * @return {Cursor} The position the cursor should move to.
 */
export function moveToWord(
  adapter: EditorAdapter,
  cur: Pos,
  repeat: number,
  forward: boolean,
  wordEnd: boolean,
  bigWord: boolean,
): Pos {
  const curStart = copyCursor(cur)
  const words: { line: number; from: number; to: number }[] = []
  if ((forward && !wordEnd) || (!forward && wordEnd)) {
    repeat++
  }
  // For 'e', empty lines are not considered words, go figure.
  const emptyLineIsWord = !(forward && wordEnd)
  for (let i = 0; i < repeat; i++) {
    const word = findWord(adapter, cur, forward, bigWord, emptyLineIsWord)
    if (!word) {
      const eodCh = lineLength(adapter, adapter.lastLine())
      words.push(forward ? { line: adapter.lastLine(), from: eodCh, to: eodCh } : { line: 0, from: 0, to: 0 })
      break
    }
    words.push(word)
    cur = makePos(word.line, forward ? word.to - 1 : word.from)
  }
  const shortCircuit = words.length !== repeat
  const firstWord = words[0]
  let lastWord = words.pop()!
  if (forward && !wordEnd) {
    // w
    if (!shortCircuit && (firstWord.from !== curStart.ch || firstWord.line !== curStart.line)) {
      // We did not start in the middle of a word. Discard the extra word at the end.
      lastWord = words.pop()!
    }
    return makePos(lastWord.line, lastWord.from)
  } else if (forward && wordEnd) {
    return makePos(lastWord.line, lastWord.to - 1)
  } else if (!forward && wordEnd) {
    // ge
    if (!shortCircuit && (firstWord.to !== curStart.ch || firstWord.line !== curStart.line)) {
      // We did not start in the middle of a word. Discard the extra word at the end.
      lastWord = words.pop()!
    }
    return makePos(lastWord.line, lastWord.to)
  } else {
    // b
    return makePos(lastWord.line, lastWord.from)
  }
}

/*
 * Returns the boundaries of the next word. If the cursor in the middle of
 * the word, then returns the boundaries of the current word, starting at
 * the cursor. If the cursor is at the start/end of a word, and we are going
 * forward/backward, respectively, find the boundaries of the next word.
 *
 * @param {EditorAdapter} adapter CodeMirror object.
 * @param {Cursor} cur The cursor position.
 * @param {boolean} forward True to search forward. False to search
 *     backward.
 * @param {boolean} bigWord True if punctuation count as part of the word.
 *     False if only [a-zA-Z0-9] characters count as part of the word.
 * @param {boolean} emptyLineIsWord True if empty lines should be treated
 *     as words.
 * @return {Object{from:number, to:number, line: number}} The boundaries of
 *     the word, or null if there are no more words.
 */
function findWord(adapter: EditorAdapter, cur: Pos, forward: boolean, bigWord: boolean, emptyLineIsWord: boolean) {
  let lineNum = cur.line
  let pos = cur.ch
  let line = adapter.getLine(lineNum)
  const dir = forward ? 1 : -1
  const charTests = bigWord ? bigWordCharTest : keywordCharTest

  if (emptyLineIsWord && line === "") {
    lineNum += dir
    line = adapter.getLine(lineNum)
    if (!isLine(adapter, lineNum)) {
      return null
    }
    pos = forward ? 0 : line.length
  }

  while (true) {
    if (emptyLineIsWord && line === "") {
      return { from: 0, to: 0, line: lineNum }
    }
    const stop = dir > 0 ? line.length : -1
    let wordStart = stop
    let wordEnd = stop
    // Find bounds of next word.
    while (pos !== stop) {
      let foundWord = false
      for (let i = 0; i < charTests.length && !foundWord; ++i) {
        if (charTests[i](line.charAt(pos))) {
          wordStart = pos
          // Advance to end of word.
          while (pos !== stop && charTests[i](line.charAt(pos))) {
            pos += dir
          }
          wordEnd = pos
          foundWord = wordStart !== wordEnd
          if (wordStart === cur.ch && lineNum === cur.line && wordEnd === wordStart + dir) {
          } else {
            return {
              from: Math.min(wordStart, wordEnd + 1),
              to: Math.max(wordStart, wordEnd),
              line: lineNum,
            }
          }
        }
      }
      if (!foundWord) {
        pos += dir
      }
    }
    // Advance to next/prev line.
    lineNum += dir
    if (!isLine(adapter, lineNum)) {
      return null
    }
    line = adapter.getLine(lineNum)
    pos = dir > 0 ? 0 : line.length
  }
}

export function charIdxInLine(start: number, line: string, character: string, forward: boolean, includeChar: boolean) {
  // Search for char in line.
  // motion_options: {forward, includeChar}
  // If includeChar = true, include it too.
  // If forward = true, search forward, else search backwards.
  // If char is not found on this line, do nothing
  let idx
  if (forward) {
    idx = line.indexOf(character, start + 1)
    if (idx !== -1 && !includeChar) {
      idx -= 1
    }
  } else {
    idx = line.lastIndexOf(character, start - 1)
    if (idx !== -1 && !includeChar) {
      idx += 1
    }
  }
  return idx
}

export function moveToCharacter(adapter: EditorAdapter, repeat: number, forward: boolean, character: string) {
  const cur = adapter.getCursor()
  let start = cur.ch
  let idx = 0
  for (let i = 0; i < repeat; i++) {
    const line = adapter.getLine(cur.line)
    idx = charIdxInLine(start, line, character, forward, true)
    if (idx === -1) {
      return null
    }
    start = idx
  }
  return makePos(adapter.getCursor().line, idx)
}

export function recordLastCharacterSearch(increment: number, args: MotionArgs) {
  vimGlobalState.lastCharacterSearch.increment = increment
  vimGlobalState.lastCharacterSearch.forward = !!args.forward
  vimGlobalState.lastCharacterSearch.selectedCharacter = args.selectedCharacter!
}

function isLine(adapter: EditorAdapter, line: number) {
  return line >= adapter.firstLine() && line <= adapter.lastLine()
}
