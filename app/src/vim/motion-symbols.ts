import { copyCursor, makePos } from "@revim/vim-keybindings"
import type EditorAdapter from "./adapter"

const ForwardSymbolPairs: Record<string, string> = { ")": "(", "}": "{" }
const ReverseSymbolPairs: Record<string, string> = { "(": ")", "{": "}" }

type SymbolMode = "bracket" | "section" | "comment" | "method" | "preprocess"

const symbolToMode: Record<string, SymbolMode> = {
  "(": "bracket",
  ")": "bracket",
  "{": "bracket",
  "}": "bracket",
  "[": "section",
  "]": "section",
  "*": "comment",
  "/": "comment",
  m: "method",
  M: "method",
  "#": "preprocess",
}

interface FindSymbolState {
  lineText: string
  nextCh: string
  lastCh: string
  index: number
  symb: string
  reverseSymb: string
  forward: boolean
  depth: number
  curMoveThrough: boolean
}

interface SymbolModeHandler {
  init: (state: FindSymbolState) => void
  isComplete: (state: FindSymbolState) => boolean
}

const findSymbolModes: Record<SymbolMode, SymbolModeHandler> = {
  bracket: {
    init: (_state) => {},
    isComplete: (state) => {
      if (state.nextCh === state.symb) {
        state.depth++
        if (state.depth >= 1) return true
      } else if (state.nextCh === state.reverseSymb) {
        state.depth--
      }
      return false
    },
  },
  section: {
    init: (state) => {
      state.curMoveThrough = true
      state.symb = (state.forward ? "]" : "[") === state.symb ? "{" : "}"
    },
    isComplete: (state) => state.index === 0 && state.nextCh === state.symb,
  },
  comment: {
    init: () => {},
    isComplete: (state) => {
      const found = state.lastCh === "*" && state.nextCh === "/"
      state.lastCh = state.nextCh
      return found
    },
  },
  // TODO: The original Vim implementation only operates on level 1 and 2.
  // The current implementation doesn't check for code block level and
  // therefore it operates on any levels.
  method: {
    init: (state) => {
      state.symb = state.symb === "m" ? "{" : "}"
      state.reverseSymb = state.symb === "{" ? "}" : "{"
    },
    isComplete: (state) => {
      if (state.nextCh === state.symb) return true
      return false
    },
  },
  preprocess: {
    init: (state) => {
      state.index = 0
    },
    isComplete: (state) => {
      if (state.nextCh === "#") {
        const token = state.lineText.match(/^#(\w+)/)?.[1]
        if (token === "endif") {
          if (state.forward && state.depth === 0) {
            return true
          }
          state.depth++
        } else if (token === "if") {
          if (!state.forward && state.depth === 0) {
            return true
          }
          state.depth--
        }
        if (token === "else" && state.depth === 0) return true
      }
      return false
    },
  },
}

export function findSymbol(adapter: EditorAdapter, repeat: number, forward: boolean, symb: string) {
  const cur = copyCursor(adapter.getCursor())
  const increment = forward ? 1 : -1
  const endLine = forward ? adapter.lineCount() : -1
  const curCh = cur.ch
  let line = cur.line
  const lineText = adapter.getLine(line)
  const state: FindSymbolState = {
    lineText: lineText,
    nextCh: lineText.charAt(curCh),
    lastCh: "",
    index: curCh,
    symb: symb,
    reverseSymb: (forward ? ForwardSymbolPairs : ReverseSymbolPairs)[symb],
    forward: forward,
    depth: 0,
    curMoveThrough: false,
  }
  const mode = symbolToMode[symb]
  if (!mode) return cur
  const modeHandler = findSymbolModes[mode]
  modeHandler.init(state)
  while (line !== endLine && repeat) {
    state.index += increment
    state.nextCh = state.lineText.charAt(state.index)
    if (!state.nextCh) {
      line += increment
      state.lineText = adapter.getLine(line) || ""
      if (increment > 0) {
        state.index = 0
      } else {
        const lineLen = state.lineText.length
        state.index = lineLen > 0 ? lineLen - 1 : 0
      }
      state.nextCh = state.lineText.charAt(state.index)
    }
    if (modeHandler.isComplete(state)) {
      cur.line = line
      cur.ch = state.index
      repeat--
    }
  }
  if (state.nextCh || state.curMoveThrough) {
    return makePos(line, state.index)
  }
  return cur
}
