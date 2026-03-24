import { initTui, shutdownTui, startKeyboardListener, moveCursor } from "@revim/lib";

async function main() {
  initTui();
  
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
        
        const directionMap: Record<string, string> = {
          ArrowUp: "up",
          ArrowDown: "down",
          ArrowLeft: "left",
          ArrowRight: "right",
        };
        
        const direction = directionMap[event.key];
        if (direction) {
          moveCursor(direction);
        }
      });
    });
  } finally {
    shutdownTui();
  }
  
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});