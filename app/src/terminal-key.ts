export interface RawTerminalKeyEvent {
  key: string;
  modifiers: string[];
}

const keyAliases: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Enter: "Enter",
  Backspace: "Backspace",
  Tab: "Tab",
  Escape: "Esc",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

export function normalizeCtrlCharacter(key: string): string {
  if (key.length !== 1) {
    return key;
  }

  const code = key.charCodeAt(0);
  if (code >= 1 && code <= 26) {
    return String.fromCharCode(code + 96);
  }

  return key;
}

export function encodeTerminalKey(
  event: RawTerminalKeyEvent,
  insertMode: boolean
): string {
  let key = keyAliases[event.key] || event.key;
  const hasCtrl = event.modifiers.includes("Ctrl");
  const hasAlt = event.modifiers.includes("Alt");
  const hasShift = event.modifiers.includes("Shift");
  if (hasCtrl) {
    key = normalizeCtrlCharacter(key);
  }
  const isPrintable = key.length === 1;

  if (key === " " && !insertMode && !hasCtrl && !hasAlt && !hasShift) {
    key = "Space";
  } else if (isPrintable && !hasCtrl && !hasAlt) {
    return `'${key}'`;
  }

  if (hasCtrl) {
    key = `Ctrl-${key}`;
  }
  if (hasShift && !(isPrintable && !hasCtrl && !hasAlt)) {
    key = `Shift-${key}`;
  }
  if (hasAlt) {
    key = `Alt-${key}`;
  }

  return key;
}
