import { CmSelection } from "./adapter-types"
import type { KeyMapEntry } from "./adapter-interface"
import type { IEditorAdapter } from "./adapter-interface"
import { keyMap } from "./vim-registry"
import {
  copyCursor,
  cursorEqual,
  cursorIsBefore,
  cursorMax,
  cursorMin,
  isUpperCase,
  isWhiteSpaceString,
  makePos,
  type Pos,
} from "./common"
import { defaultKeymap } from "./default-key-map"
import { vimGlobalState } from "./global"
import { InputState } from "./input-state"
import { defineOption } from "./options"
import { cancelPendingHighlight } from "./search-utils"
import type {
  Context,
  KeyMapping,
  KeyMappingAction,
  KeyMappingEx,
  KeyMappingMotion,
  KeyMappingOperator,
  KeyMappingOperatorMotion,
  KeyMappingSearch,
  MappableArgType,
  MappableCommandType,
  VimState,
} from "./types"
import { VimApi } from "./vim-api"
import { clipCursorToContent, lineLength, offsetCursor } from "./vim-utils"

function enterVimMode(adapter: IEditorAdapter) {
  adapter.setOption("disableInput", true)
  adapter.setOption("showCursorWhenSelecting", false)
  adapter.emitVimModeChange({ mode: "normal" })
  adapter.on("cursorActivity", onCursorActivity)
  maybeInitVimState(adapter)
  adapter.enterVimMode()
}

function leaveVimMode(adapter: IEditorAdapter) {
  adapter.setOption("disableInput", false)
  adapter.off("cursorActivity", onCursorActivity)
  adapter.state.vim = null
  cancelPendingHighlight()
  adapter.leaveVimMode()
}

function detachVimMap(adapter: IEditorAdapter, next?: KeyMapEntry) {
  adapter.attached = false

  if (!next || next.attach !== attachVimMap) leaveVimMode(adapter)
}
function attachVimMap(
  this: {
    attach: (adapter: IEditorAdapter, prev?: KeyMapEntry) => void
    detach: (adapter: IEditorAdapter, next?: KeyMapEntry | undefined) => void
    call: (key: string, adapter: IEditorAdapter) => false | (() => boolean) | undefined
    fallthrough?: string[]
    keys?: { Backspace: string }
  },
  adapter: IEditorAdapter,
  prev?: KeyMapEntry,
) {
  if ((this as KeyMapEntry) === keyMap.vim) {
    adapter.attached = true
    if (adapter.curOp) {
      adapter.curOp.selectionChanged = true
    }
  }

  if (!prev || prev.attach !== attachVimMap) enterVimMode(adapter)
}

function cmKey(key: string, adapter: IEditorAdapter) {
  if (!adapter) {
    return undefined
  }
  const vimKey = cmKeyToVimKey(key)
  if (!vimKey) {
    return false
  }
  const cmd = vimApi.findKey(adapter, vimKey)
  if (typeof cmd === "function") {
    adapter.dispatch("vim-keypress", vimKey)
  }
  return cmd
}

const modifiers: Record<string, string> = {
  Shift: "S",
  Ctrl: "C",
  Alt: "A",
  Cmd: "D",
  Mod: "A",
  CapsLock: "",
}
const specialKeys: Record<string, string> = {
  Enter: "CR",
  Backspace: "BS",
  Delete: "Del",
  Insert: "Ins",
}
function cmKeyToVimKey(key: string) {
  if (key.charAt(0) === "'") {
    // Keypress character binding of format "'a'"
    return key.charAt(1)
  }
  if (key === "AltGraph") {
    return false
  }
  const pieces = key.split(/-(?!$)/)
  const lastPiece = pieces[pieces.length - 1]
  if (pieces.length === 1 && pieces[0].length === 1) {
    // No-modifier bindings use literal character bindings above. Skip.
    return false
  } else if (pieces.length === 2 && pieces[0] === "Shift" && lastPiece.length === 1) {
    // Ignore Shift+char bindings as they should be handled by literal character.
    return false
  }
  let hasCharacter = false
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]
    if (piece in modifiers) {
      pieces[i] = modifiers[piece]
    } else {
      hasCharacter = true
    }
    if (piece in specialKeys) {
      pieces[i] = specialKeys[piece]
    }
  }
  if (!hasCharacter) {
    // Vim does not support modifier only keys.
    return false
  }
  // TODO: Current bindings expect the character to be lower case, but
  // it looks like vim key notation uses upper case.
  if (isUpperCase(lastPiece)) {
    pieces[pieces.length - 1] = lastPiece.toLowerCase()
  }
  return `<${pieces.join("-")}>`
}

export const keywordCharTest = [
  (ch: string) => isKeywordTest(ch),
  (ch: string) => !!(ch && !isKeywordTest(ch) && !/\s/.test(ch)),
]
export const bigWordCharTest = [(ch: string) => /\S/.test(ch)]
function makeKeyRange(start: number, size: number) {
  const keys = []
  for (let i = start; i < start + size; i++) {
    keys.push(String.fromCharCode(i))
  }
  return keys
}
const upperCaseAlphabet = makeKeyRange(65, 26)
const lowerCaseAlphabet = makeKeyRange(97, 26)
const numbers = makeKeyRange(48, 10)
export const validMarks = [...upperCaseAlphabet, ...lowerCaseAlphabet, ...numbers, "<", ">"]
export const validRegisters = [...upperCaseAlphabet, ...lowerCaseAlphabet, ...numbers, "-", '"', ".", ":", "_", "/"]

defineOption("filetype", undefined, "string", ["ft"], (name, adapter) => {
  // Option is local. Do nothing for global.
  if (adapter === undefined) {
    return
  }
  // The 'filetype' option proxies to the EditorAdapter 'mode' option.
  if (name === undefined) {
    const mode = adapter.getOption("mode")
    return mode === "null" ? "" : mode
  } else {
    const mode = name === "" ? "null" : name
    adapter.setOption("mode", mode)
  }
})

export function maybeInitVimState(adapter: IEditorAdapter): VimState {
  if (!adapter.state.vim) {
    // Store instance state in the EditorAdapter object.
    const vimState: VimState = {
      inputState: new InputState(),
      // Vim's input state that triggered the last edit, used to repeat
      // motions and operators with '.'.
      lastEditInputState: undefined,
      // Vim's action command before the last edit, used to repeat actions
      // with '.' and insert mode repeat.
      lastEditActionCommand: undefined,
      // When using jk for navigation, if you move from a longer line to a
      // shorter line, the cursor may clip to the end of the shorter line.
      // If j is pressed again and cursor goes to the next line, the
      // cursor should go back to its horizontal position on the longer
      // line if it can. This is to keep track of the horizontal position.
      lastHPos: -1,
      // Doing the same with screen-position for gj/gk
      lastHSPos: -1,
      // The last motion command run. Cleared if a non-motion command gets
      // executed in between.
      lastMotion: undefined,
      marks: {},
      insertMode: false,
      // Repeat count for changes made in insert mode, triggered by key
      // sequences like 3,i. Only exists when insertMode is true.
      insertModeRepeat: undefined,
      visualMode: false,
      // If we are in visual line mode. No effect if visualMode is false.
      visualLine: false,
      visualBlock: false,
      lastSelection: undefined,
      lastPastedText: undefined,
      sel: new CmSelection(makePos(0, 0), makePos(0, 0)),
      // Buffer-local/window-local values of vim options.
      options: {},
    }
    adapter.state.vim = vimState
  }
  return adapter.state.vim as VimState
}

export function clearInputState(adapter: IEditorAdapter, reason?: string) {
  ;(adapter.state.vim as VimState).inputState = new InputState()
  adapter.dispatch("vim-command-done", reason)
}

export function commandMatches(keys: string, keyMap: KeyMapping[], context: Context, inputState: InputState) {
  // Partial matches are not applied. They inform the key handler
  // that the current key sequence is a subsequence of a valid key
  // sequence, so that the key buffer is not cleared.
  let match: false | "partial" | "full"
  const partial: KeyMapping[] = []
  const full: KeyMapping[] = []

  keyMap.forEach((command) => {
    if (
      (context === "insert" && command.context !== "insert") ||
      (command.context && command.context !== context) ||
      (inputState.operator && command.type === "action") ||
      !(match = commandMatch(keys, command.keys))
    ) {
    } else if (match === "partial") {
      partial.push(command)
    } else if (match === "full") {
      full.push(command)
    }
  })
  return {
    partial: partial.length ? partial : undefined,
    full: full.length ? full : undefined,
  }
}
function commandMatch(pressed: string, mapped: string) {
  if (mapped.endsWith("<character>")) {
    // Last character matches anything.
    const prefixLen = mapped.length - 11
    const pressedPrefix = pressed.slice(0, prefixLen)
    const mappedPrefix = mapped.slice(0, prefixLen)
    return pressedPrefix === mappedPrefix && pressed.length > prefixLen
      ? "full"
      : mappedPrefix.indexOf(pressedPrefix) === 0
        ? "partial"
        : false
  } else {
    return pressed === mapped ? "full" : mapped.indexOf(pressed) === 0 ? "partial" : false
  }
}

export function lastChar(keys: string): string {
  const match = /^.*(<[^>]+>)$/.exec(keys)
  let selectedCharacter = match ? match[1] : keys.slice(-1)
  if (selectedCharacter.length > 1) {
    switch (selectedCharacter) {
      case "<CR>":
        selectedCharacter = "\n"
        break
      case "<Space>":
        selectedCharacter = " "
        break
      default:
        selectedCharacter = ""
        break
    }
  }
  return selectedCharacter
}

// Updates the previous selection with the current selection's values. This
// should only be called in visual mode.
export function updateLastSelection(adapter: IEditorAdapter, vim: VimState) {
  const anchor = vim.sel.anchor
  let head = vim.sel.head
  // To accommodate the effect of lastPastedText in the last selection
  if (vim.lastPastedText) {
    head = adapter.posFromIndex(adapter.indexFromPos(anchor) + vim.lastPastedText.length)
    vim.lastPastedText = undefined
  }
  vim.lastSelection = {
    anchorMark: adapter.setBookmark(anchor),
    headMark: adapter.setBookmark(head),
    anchor: copyCursor(anchor),
    head: copyCursor(head),
    visualMode: vim.visualMode,
    visualLine: vim.visualLine,
    visualBlock: vim.visualBlock,
  }
}

export function updateMark(adapter: IEditorAdapter, vim: VimState, markName: string, pos: Pos) {
  if (!validMarks.includes(markName)) {
    return
  }
  if (vim.marks[markName]) {
    vim.marks[markName].clear()
  }
  vim.marks[markName] = adapter.setBookmark(pos)
}

/**
 * Updates the EditorAdapter selection to match the provided vim selection.
 * If no arguments are given, it uses the current vim selection state.
 */
export function updateCmSelection(adapter: IEditorAdapter, sel?: CmSelection, mode?: "line" | "block" | "char") {
  const vim = adapter.state.vim as VimState
  sel = sel || vim.sel
  mode = mode || vim.visualLine ? "line" : vim.visualBlock ? "block" : "char"
  const cmSel = makeCmSelection(adapter, sel, mode)
  adapter.setSelections(cmSel.ranges, cmSel.primary)
}

export function makeCmSelection(
  adapter: IEditorAdapter,
  sel: CmSelection,
  mode: "line" | "block" | "char",
  exclusive?: boolean,
): {
  ranges: CmSelection[]
  primary: number
} {
  let head = copyCursor(sel.head)
  let anchor = copyCursor(sel.anchor)
  switch (mode) {
    case "char": {
      const headOffset = !exclusive && !cursorIsBefore(sel.head, sel.anchor) ? 1 : 0
      const anchorOffset = cursorIsBefore(sel.head, sel.anchor) ? 1 : 0
      head = offsetCursor(sel.head, 0, headOffset)
      anchor = offsetCursor(sel.anchor, 0, anchorOffset)
      return {
        ranges: [new CmSelection(anchor, head)],
        primary: 0,
      }
    }
    case "line":
      if (!cursorIsBefore(sel.head, sel.anchor)) {
        anchor.ch = 0

        const lastLine = adapter.lastLine()
        if (head.line > lastLine) {
          head.line = lastLine
        }
        head.ch = lineLength(adapter, head.line)
      } else {
        head.ch = 0
        anchor.ch = lineLength(adapter, anchor.line)
      }
      return {
        ranges: [new CmSelection(anchor, head)],
        primary: 0,
      }
    case "block": {
      const top = Math.min(anchor.line, head.line)
      let fromCh = anchor.ch
      const bottom = Math.max(anchor.line, head.line)
      let toCh = head.ch
      if (fromCh < toCh) {
        toCh += 1
      } else {
        fromCh += 1
      }
      const height = bottom - top + 1
      const primary = head.line === top ? 0 : height - 1
      const ranges: CmSelection[] = []
      for (let i = 0; i < height; i++) {
        ranges.push(new CmSelection(makePos(top + i, fromCh), makePos(top + i, toCh)))
      }
      return {
        ranges: ranges,
        primary: primary,
      }
    }
  }
}

function getHead(adapter: IEditorAdapter) {
  const cur = adapter.getCursor("head")
  if (adapter.getSelection().length === 1) {
    // Small corner case when only 1 character is selected. The "real"
    // head is the left of head and anchor.
    return cursorMin(cur, adapter.getCursor("anchor"))
  }
  return cur
}

/**
 * If moveHead is set to false, the EditorAdapter selection will not be
 * touched. The caller assumes the responsibility of putting the cursor
 * in the right place.
 */
export function exitVisualMode(adapter: IEditorAdapter, moveHead?: boolean) {
  const vim = adapter.state.vim as VimState
  if (moveHead !== false) {
    adapter.setCursor(clipCursorToContent(adapter, vim.sel.head))
  }
  updateLastSelection(adapter, vim)
  vim.visualMode = false
  vim.visualLine = false
  vim.visualBlock = false
  if (!vim.insertMode) adapter.emitVimModeChange({ mode: "normal" })
}

// Remove any trailing newlines from the selection. For
// example, with the caret at the start of the last word on the line,
// 'dw' should word, but not the newline, while 'w' should advance the
// caret to the first character of the next line.
export function clipToLine(adapter: IEditorAdapter, curStart: Pos, curEnd: Pos) {
  const selection = adapter.getRange(curStart, curEnd)
  // Only clip if the selection ends with trailing newline + whitespace
  if (/\n\s*$/.test(selection)) {
    const lines = selection.split("\n")
    // We know this is all whitespace.
    lines.pop()

    // Cases:
    // 1. Last word is an empty line - do not clip the trailing '\n'
    // 2. Last word is not an empty line - clip the trailing '\n'
    let line: string | undefined
    // Find the line containing the last word, and clip all whitespace up
    // to it.
    for (line = lines.pop(); lines.length > 0 && line && isWhiteSpaceString(line); line = lines.pop()) {
      curEnd.line--
      curEnd.ch = 0
    }
    // If the last word is not an empty line, clip an additional newline
    if (line) {
      curEnd.line--
      curEnd.ch = lineLength(adapter, curEnd.line)
    } else {
      curEnd.ch = 0
    }
  }
}

// Expand the selection to line ends.
export function expandSelectionToLine(_cm: IEditorAdapter, curStart: Pos, curEnd: Pos) {
  curStart.ch = 0
  curEnd.ch = 0
  curEnd.line++
}

export function expandWordUnderCursor(
  adapter: IEditorAdapter,
  inclusive: boolean,
  _forward: boolean,
  bigWord: boolean,
  noSymbol?: boolean,
): [Pos, Pos] | undefined {
  const cur = getHead(adapter)
  const line = adapter.getLine(cur.line)
  let idx = cur.ch

  // Seek to first word or non-whitespace character, depending on if
  // noSymbol is true.
  let test: (ch: string) => boolean = noSymbol ? keywordCharTest[0] : bigWordCharTest[0]
  while (!test(line.charAt(idx))) {
    idx++
    if (idx >= line.length) {
      return
    }
  }

  if (bigWord) {
    test = bigWordCharTest[0]
  } else {
    test = isKeywordTest
    if (!test(line.charAt(idx))) {
      test = keywordCharTest[1]
    }
  }

  let end = idx
  let start = idx
  while (test(line.charAt(end)) && end < line.length) {
    end++
  }
  while (test(line.charAt(start)) && start >= 0) {
    start--
  }
  start++

  if (inclusive) {
    // If present, include all whitespace after word.
    // Otherwise, include all whitespace before word, except indentation.
    const wordEnd = end
    while (/\s/.test(line.charAt(end)) && end < line.length) {
      end++
    }
    if (wordEnd === end) {
      const wordStart = start
      while (/\s/.test(line.charAt(start - 1)) && start > 0) {
        start--
      }
      if (!start) {
        start = wordStart
      }
    }
  }
  return [makePos(cur.line, start), makePos(cur.line, end)]
}

export function recordJumpPosition(adapter: IEditorAdapter, oldCur: Pos, newCur: Pos) {
  if (!cursorEqual(oldCur, newCur)) {
    vimGlobalState.jumpList.add(adapter, oldCur, newCur)
  }
}

export function getMarkPos(adapter: IEditorAdapter, vim: VimState, markName: string) {
  if (markName === "'" || markName === "`") {
    return vimGlobalState.jumpList.find(adapter, -1) || makePos(0, 0)
  } else if (markName === ".") {
    return null
  }

  const mark = vim.marks[markName]
  return mark?.find()
}

/**
 * Listens for any kind of cursor activity on EditorAdapter.
 */
function onCursorActivity(adapter: IEditorAdapter) {
  const vim = adapter.state.vim as VimState
  if (vim.insertMode) {
    // Tracking cursor activity in insert mode (for macro support).
    const macroModeState = vimGlobalState.macroModeState
    if (macroModeState.isPlaying) {
      return
    }
    const lastChange = macroModeState.lastInsertModeChanges
    if (lastChange.expectCursorActivityForChange) {
      lastChange.expectCursorActivityForChange = false
    } else {
      // Cursor moved outside the context of an edit. Reset the change.
      lastChange.maybeReset = true
    }
  } else if (!adapter.curOp.isVimOp) {
    handleExternalSelection(adapter, vim)
  }
}
function handleExternalSelection(adapter: IEditorAdapter, vim: VimState) {
  let anchor = adapter.getCursor("anchor")
  let head = adapter.getCursor("head")
  // Enter or exit visual mode to match mouse selection.
  if (vim.visualMode && !adapter.somethingSelected()) {
    exitVisualMode(adapter, false)
  } else if (!vim.visualMode && !vim.insertMode && adapter.somethingSelected()) {
    vim.visualMode = true
    vim.visualLine = false
    adapter.emitVimModeChange({ mode: "visual" })
  }
  if (vim.visualMode) {
    // Bind EditorAdapter selection model to vim selection model.
    // Mouse selections are considered visual characterwise.
    const headOffset = !cursorIsBefore(head, anchor) ? -1 : 0
    const anchorOffset = cursorIsBefore(head, anchor) ? -1 : 0
    head = offsetCursor(head, 0, headOffset)
    anchor = offsetCursor(anchor, 0, anchorOffset)
    vim.sel = new CmSelection(anchor, head)
    updateMark(adapter, vim, "<", cursorMin(head, anchor))
    updateMark(adapter, vim, ">", cursorMax(head, anchor))
  } else if (!vim.insertMode) {
    // Reset lastHPos if selection was modified by something outside of vim mode e.g. by mouse.
    vim.lastHPos = adapter.getCursor().ch
  }
}

export function _mapCommand(command: KeyMapping) {
  defaultKeymap.unshift(command)
}

export function mapCommand(keys: string, type: MappableCommandType, name: string, args: MappableArgType, extra: any) {
  const command = createKeyMapping(keys, type, name, args)
  _mapCommand({ ...command, ...extra })
}

function createKeyMapping(keys: string, type: string, name: string, args: MappableArgType): KeyMapping {
  const command = { keys: keys, type: type }
  switch (type) {
    case "motion":
      return { ...command, motion: name, motionArgs: args } as KeyMappingMotion
    case "action":
      return { ...command, action: name, actionArgs: args } as KeyMappingAction
    case "operator":
      return { ...command, operator: name, operatorArgs: args } as KeyMappingOperator
    case "operatorMotion":
      return { ...command, operatorMotion: name, operatorMotionArgs: args } as KeyMappingOperatorMotion
    case "search":
      return { ...command, search: name, searchArgs: args } as KeyMappingSearch
    case "ex":
      return { ...command, ex: name, exArgs: args } as KeyMappingEx
    default:
      throw new Error(`Unknown key mapping type: ${type}`)
  }
}

// The timeout in milliseconds for the two-character ESC keymap should be
// adjusted according to your typing speed to prevent false positives.
defineOption("insertModeEscKeysTimeout", 200, "number")

export const initVimAdapter = () => {
  keyMap.vim = {
    attach: attachVimMap,
    detach: detachVimMap,
    call: cmKey,
  }

  keyMap["vim-insert"] = {
    // TODO: override navigation keys so that Esc will cancel automatic
    // indentation from o, O, i_<CR>
    fallthrough: ["default"],
    attach: attachVimMap,
    detach: detachVimMap,
    call: cmKey,
  }

  keyMap["vim-replace"] = {
    keys: { Backspace: "goCharLeft" },
    fallthrough: ["vim-insert"],
    attach: attachVimMap,
    detach: detachVimMap,
    call: cmKey,
  }
}

interface CharRange {
  from: number
  to: number
}
const kDefaultIsKeyword = "@,48-57,_,192-255"
let isKeywordRanges: CharRange[] = []
let isKeywordValue: string

const isKeywordTest = (ch: string): boolean => {
  if (!ch) {
    return false
  }
  const code = ch.charCodeAt(0)
  return isKeywordRanges.some((r) => code >= r.from && code <= r.to)
}

defineOption(
  "iskeyword",
  "@,48-57,_,192-255",
  "string",
  ["isk"],
  (value) => {
    if (typeof value !== "string") {
      return isKeywordValue || kDefaultIsKeyword
    }
    const parts = value.split(",")

    const ranges = parts.reduce((l: CharRange[], p) => {
      // @ represents alpha characters
      if (p === "@") {
        return [
          ...l,
          { from: "A".charCodeAt(0), to: "Z".charCodeAt(0) },
          { from: "a".charCodeAt(0), to: "z".charCodeAt(0) },
        ]
      }
      // @-@ represents the character @
      if (p === "@-@") {
        const at = "@".charCodeAt(0)
        return [...l, { from: at, to: at }]
      }
      //  <num>-<num> is an inclusive range of characters
      const m = p.match(/^(\d+)-(\d+)$/)
      if (m) {
        return [...l, { from: Number(m[1]), to: Number(m[2]) }]
      }
      // <num> is a single character code
      const n = Number(p)
      if (!Number.isNaN(n)) {
        return [...l, { from: n, to: n }]
      }
      // any single character is itself
      if (p.length === 1) {
        const ch = p.charCodeAt(0)
        return [...l, { from: ch, to: ch }]
      }
      // ignore anything else
      return l
    }, [])
    isKeywordRanges = ranges
    isKeywordValue = value
    return isKeywordValue
  },
  {
    commas: true,
  },
)

defineOption("background", "dark", "string", ["bg"], (value?: string | number | boolean, adapter?: IEditorAdapter) => {
  if (typeof value !== "string") {
    if (adapter) {
      const theme = adapter.getOption("theme").toString().toLowerCase()
      if (theme.endsWith("light")) {
        return "light"
      } else if (theme.endsWith("dark")) {
        return "dark"
      }
    }
    return ""
  }

  if (!adapter) {
    return ""
  }
  const theme = adapter.getOption("theme").toString()
  if (theme.toLowerCase().endsWith(value)) {
    return value
  }

  switch (value) {
    case "light":
      adapter.setOption("theme", `${theme.substring(0, theme.length - 4)}Light`)
      break
    case "dark":
      adapter.setOption("theme", `${theme.substring(0, theme.length - 5)}Dark`)
      break
    default:
      throw new Error(`Invalid option: background=${value}`)
  }
  return value
})

defineOption("expandtab", undefined, "boolean", ["et"], (value, adapter) => {
  if (value === undefined) {
    if (adapter) {
      return !adapter.getOption("indentWithTabs")
    }
  } else if (adapter) {
    adapter.setOption("indentWithTabs", !value)
    return !!value
  }
  return false
})

defineOption("tabstop", undefined, "number", ["ts"], (value, adapter) => {
  if (value === undefined) {
    if (adapter) {
      const current = adapter.getOption("tabSize")
      if (typeof current === "number") {
        return current
      } else if (!Number.isNaN(Number(current))) {
        return Number(current)
      }
    }
  } else if (adapter) {
    if (typeof value !== "number") {
      value = Number(value)
    }
    if (!Number.isNaN(value)) {
      adapter.setOption("tabSize", value)
      return value
    }
  }
  return 8
})

export const vimApi = new VimApi()
