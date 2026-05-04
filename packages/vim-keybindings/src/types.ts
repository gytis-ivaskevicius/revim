import type { Pos } from "./common"

// --- From app/src/vim/adapter.ts ---

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

export interface Change {
  text: string[]
  origin: "+input" | "paste"
  next?: Change
}

interface MatchingBracket {
  symbol: string
  pair: string
  mode: "open" | "close"
  regex: RegExp
}

export const kMatchingBrackets: Record<string, MatchingBracket> = {
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

// --- From app/src/vim/types.ts ---

export type VimOptions = Record<string, { value?: string | number | boolean }>

export interface MotionArgs {
  linewise?: boolean
  toJumplist?: boolean
  forward?: boolean
  wordEnd?: boolean
  bigWord?: boolean
  inclusive?: boolean
  explicitRepeat?: boolean
  toFirstChar?: boolean
  repeatOffset?: number
  sameLine?: boolean
  textObjectInner?: boolean
  selectedCharacter?: string
  repeatIsExplicit?: boolean
  noRepeat?: boolean
  repeat?: number
}

export interface ActionArgs {
  after?: boolean
  isEdit?: boolean
  matchIndent?: boolean
  forward?: boolean
  linewise?: boolean
  insertAt?: string
  blockwise?: boolean
  keepSpaces?: boolean
  replace?: boolean
  position?: "center" | "top" | "bottom"
  increase?: boolean
  backtrack?: boolean
  indentRight?: boolean
  selectedCharacter?: string
  repeat?: number
  repeatIsExplicit?: boolean
  registerName?: string
  head?: Pos
}

export interface SearchArgs {
  forward: boolean
  querySrc: "prompt" | "wordUnderCursor"
  toJumplist: boolean
  wholeWordOnly?: boolean
  selectedCharacter?: string
}

export interface OperatorMotionArgs {
  visualLine: boolean
}

export interface ExArgs {
  input: string
}

export type MappableCommandType = "motion" | "action" | "operator" | "operatorMotion" | "search" | "ex"

export type ExCommandDefault = {
  name: string
  shortName?: string
  excludeFromCommandHistory?: boolean
  user?: boolean
  possiblyAsync?: boolean
}
export type ExCommandExToEx = ExCommandDefault & { type: "exToEx"; toInput: string }
export type ExCommandExToKey = ExCommandDefault & { type: "exToKey"; toKeys: string }
export type ExCommandApi = ExCommandDefault & { type: "api" }

export type ExCommand = ExCommandExToEx | ExCommandExToKey | ExCommandApi
