import { initTui, shutdownTui, startKeyboardListener } from "@revim/lib";
import { encodeTerminalKey } from "./terminal-key";
import { VimMode } from "./vim";

function processKeyEvent(vimMode: VimMode, event: { key: string; modifiers: string[] }) {
  const insertMode = Boolean(vimMode.adapter.state.vim?.insertMode);
  vimMode.handleKey(encodeTerminalKey(event, insertMode));
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
