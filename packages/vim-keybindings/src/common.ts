export interface Pos {
  line: number
  ch: number
}

export const isPos = (value: any): value is Pos =>
  value && typeof value.line === "number" && typeof value.ch === "number"

export const makePos = (line: number, ch: number): Pos => ({
  line: line,
  ch: ch,
})

export const copyCursor = (cur: Pos): Pos => ({ ...cur })

export const cursorEqual = (cur1: Pos, cur2: Pos): boolean => cur1.ch === cur2.ch && cur1.line === cur2.line

export const cursorIsBefore = (cur1: Pos, cur2: Pos): boolean => {
  if (cur1.line < cur2.line) {
    return true
  }
  if (cur1.line === cur2.line && cur1.ch < cur2.ch) {
    return true
  }
  return false
}

export const cursorMin = (...cursors: Pos[]): Pos => cursors.reduce((m, cur) => (cursorIsBefore(m, cur) ? m : cur))

export const cursorMax = (...cursors: Pos[]): Pos => cursors.reduce((m, cur) => (cursorIsBefore(m, cur) ? cur : m))

export const cursorIsBetween = (low: Pos, test: Pos, high: Pos): boolean =>
  cursorIsBefore(low, test) && cursorIsBefore(test, high)
