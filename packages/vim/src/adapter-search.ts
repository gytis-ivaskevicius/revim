import { makePos, type Pos } from "./common"

export interface LineAccessor {
  getLine(line: number): string
  lineCount(): number
}

export interface MatchingBracket {
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

// Extracted from EditorAdapter.escapeRegex. Note: search-utils.ts has a similar escapeRegex with
// a slightly different character class — this preserves the original adapter.ts behavior unchanged.
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function scanForBracket(
  accessor: LineAccessor,
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
    if (searchLine < 0 || searchLine >= accessor.lineCount()) {
      return undefined
    }

    const line = accessor.getLine(searchLine)
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
    if (searchLine < 0 || searchLine >= accessor.lineCount()) {
      return undefined
    }
    searchCh = dir > 0 ? 0 : accessor.getLine(searchLine).length - 1
  }
}

export function findMatchingBracket(accessor: LineAccessor, cur: Pos): { pos: Pos } | undefined {
  const line = accessor.getLine(cur.line)
  for (let ch = cur.ch; ch < line.length; ch++) {
    const curCh = line.charAt(ch)
    const matchable = kMatchingBrackets[curCh]
    if (matchable) {
      const direction = matchable.mode === "close" ? 1 : -1
      const offset = direction > 0 ? 1 : -1
      return scanForBracket(
        accessor,
        makePos(cur.line, ch + offset),
        direction,
        matchable.regex,
        matchable.symbol,
        matchable.pair,
      )
    }
  }
  return undefined
}

export interface SearchMatch {
  line: number
  ch: number
  endLine: number
  endCh: number
}

export interface SearchCursor {
  findNext(): boolean
  findPrevious(): boolean
  jumpTo(index: number): Pos | false
  find(back: boolean): boolean
  from(): Pos | undefined
  to(): Pos | undefined
  replace(text: string): void
  getMatches(): SearchMatch[]
}

export function createSearchCursor(
  accessor: LineAccessor,
  pattern: string | RegExp,
  startPos: Pos,
  replaceFn: (text: string, from: Pos, to: Pos) => void,
): SearchCursor {
  let matchCase = false
  let isRegex = false

  if (pattern instanceof RegExp) {
    matchCase = !pattern.ignoreCase
    isRegex = true
  }

  const query = typeof pattern === "string" ? pattern : pattern.source
  let currentIndex = -1

  const allMatches: SearchMatch[] = []
  const lineCount = accessor.lineCount()
  for (let lineIdx = 0; lineIdx < lineCount; lineIdx++) {
    const line = accessor.getLine(lineIdx)
    const regex = isRegex
      ? new RegExp(query, matchCase ? "g" : "gi")
      : new RegExp(escapeRegex(query), matchCase ? "g" : "gi")
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
            if (match.line > startPos.line || (match.line === startPos.line && match.ch > startPos.ch)) {
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
        replaceFn(text, from, to)
      }
    },
  }
}
