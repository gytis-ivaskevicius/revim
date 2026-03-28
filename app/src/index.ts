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
  const keepAlive = setInterval(() => {}, 1_000);
  let shuttingDown = false;

  const shutdown = (exitCode: number) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    clearInterval(keepAlive);
    process.removeListener("SIGINT", handleSigint);
    vimMode.disable();
    shutdownTui();
    process.exit(exitCode);
  };

  const handleSigint = () => shutdown(0);
  process.on("SIGINT", handleSigint);

  startKeyboardListener((err, event) => {
    if (err) {
      console.error("Error:", err);
      return;
    }

    if (event.key === "c" && event.modifiers.includes("Ctrl")) {
      shutdown(0);
      return;
    }

    processKeyEvent(vimMode, event);
  });

  await new Promise<never>(() => {});
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
