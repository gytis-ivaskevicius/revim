import { initTui, shutdownTui, startKeyboardListener } from "@revim/lib";
import { VimMode } from "./vim";
import { vimApi } from "./vim/keymap_vim";

function processKeyEvent(vimMode: VimMode, event: { key: string; modifiers: string[] }) {
  const keyMap: Record<string, string> = {
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Enter: "Enter",
    Backspace: "Backspace",
    Tab: "Tab",
    Escape: "Escape",
  };

  let key = keyMap[event.key] || event.key;
  
  if (event.modifiers.includes("Ctrl")) {
    key = `Ctrl-${key}`;
  }
  if (event.modifiers.includes("Shift")) {
    key = `Shift-${key}`;
  }
  if (event.modifiers.includes("Alt")) {
    key = `Alt-${key}`;
  }

  vimApi.handleKey(vimMode.adapter, key);
}

async function main() {
  initTui();

  const vimMode = new VimMode();
  vimMode.enable();

  try {
    await new Promise<void>((resolve) => {
      startKeyboardListener((err, event) => {
        if (err) {
          console.error("Error:", err);
          return;
        }

        if (event.key === "c" && event.modifiers.includes("Ctrl")) {
          resolve();
          return;
        }

        processKeyEvent(vimMode, event);
      });
    });
  } finally {
    vimMode.adapter.dispose();
    shutdownTui();
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
