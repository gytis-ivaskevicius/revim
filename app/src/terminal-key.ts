export interface RawTerminalKeyEvent {
  key: string
  modifiers: string[]
}

// Canonical mapping of terminal key names to their display values.
// Single source of truth for key name mapping shared between encoding and decoding.
// Adding a new named key to api.rs requires updating this map.
export const TERMINAL_KEY_MAP: Record<string, string> = {
  Space: " ",
  Enter: "Enter",
  Escape: "Escape",
  Esc: "Escape",
  Backspace: "Backspace",
  Tab: "Tab",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Up: "Up",
  Down: "Down",
  Left: "Left",
  Right: "Right",
}

export function normalizeCtrlCharacter(key: string): string {
  if (key.length !== 1) {
    return key
  }

  const code = key.charCodeAt(0)
  if (code >= 1 && code <= 26) {
    return String.fromCharCode(code + 96)
  }

  return key
}

export function encodeTerminalKey(event: RawTerminalKeyEvent, insertMode: boolean): string {
  let key = event.key
  const hasCtrl = event.modifiers.includes("Ctrl")
  const hasAlt = event.modifiers.includes("Alt")
  const hasShift = event.modifiers.includes("Shift")
  if (hasCtrl) {
    key = normalizeCtrlCharacter(key)
  }
  const isPrintable = key.length === 1

  if (key === " " && !insertMode && !hasCtrl && !hasAlt && !hasShift) {
    key = "Space"
  } else if (isPrintable && !hasCtrl && !hasAlt) {
    return `'${key}'`
  }

  if (hasCtrl) {
    key = `Ctrl-${key}`
  }
  if (hasShift && !(isPrintable && !hasCtrl && !hasAlt)) {
    key = `Shift-${key}`
  }
  if (hasAlt) {
    key = `Alt-${key}`
  }

  return key
}
