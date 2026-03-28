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

export function encodeTerminalKey(
  event: RawTerminalKeyEvent,
  insertMode: boolean
): string {
  let key = keyAliases[event.key] || event.key;
  const hasCtrl = event.modifiers.includes("Ctrl");
  const hasAlt = event.modifiers.includes("Alt");
  const hasShift = event.modifiers.includes("Shift");
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
