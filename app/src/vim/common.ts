export function findFirstNonWhiteSpaceCharacter(text: string) {
  if (!text) {
    return 0
  }
  const firstNonWS = text.search(/\S/)
  return firstNonWS === -1 ? text.length : firstNonWS
}

export function isLowerCase(k: string) {
  return /^[a-z]$/.test(k)
}
export function isMatchableSymbol(k: string) {
  return "()[]{}".includes(k)
}
const numberRegex = /[\d]/
export function isNumber(k: string) {
  return numberRegex.test(k)
}

const upperCaseChars = /^[\p{Lu}]$/u

export function isUpperCase(k: string) {
  return upperCaseChars.test(k)
}
export function isWhiteSpaceString(k: string) {
  return /^\s*$/.test(k)
}
export function isEndOfSentenceSymbol(k: string) {
  return ".?!".includes(k)
}
export function inArray<T>(val: T, arr: T[]) {
  return arr.includes(val)
}

export interface TerminalKeyEvent {
  key: string
  keyCode?: number
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
  stopPropagation?: () => void
  preventDefault?: () => void
  browserEvent?: {
    key?: string
    preventDefault?: () => void
  }
}

const hasBrowserEvent = (
  event: TerminalKeyEvent | KeyboardEvent,
): event is TerminalKeyEvent & { browserEvent: NonNullable<TerminalKeyEvent["browserEvent"]> } =>
  typeof event === "object" && event !== null && "browserEvent" in event && !!event.browserEvent

export const stopEvent = (evt: TerminalKeyEvent | KeyboardEvent) => {
  evt.stopPropagation?.()
  evt.preventDefault?.()
  if (hasBrowserEvent(evt)) {
    evt.browserEvent.preventDefault?.()
  }

  return false
}

export const getEventKeyName = (e: TerminalKeyEvent | KeyboardEvent, skip = false) => {
  let key = e.key || (hasBrowserEvent(e) ? e.browserEvent.key || "" : "")

  if (key === "Escape") {
    key = "Esc"
  }

  if (!skip) {
    if (e.altKey) {
      key = `Alt-${key}`
    }
    if (e.ctrlKey) {
      key = `Ctrl-${key}`
    }
    if (e.metaKey) {
      key = `Meta-${key}`
    }
    if (e.shiftKey && key.length === 1) {
      key = `Shift-${key}`
    }
  }

  return key
}
