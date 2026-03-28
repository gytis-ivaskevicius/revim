# Friction

## Terminal cursor position requires explicit set
**Date**: 2026-03-28
**What happened**: E2E tests using `terminal.getCursor()` failed because the app wasn't setting the terminal cursor position. The app only rendered the cursor using reversed style, but didn't call `set_cursor_position()`.
**Recommendation**: When testing cursor position with TUI Test, ensure the app sets the terminal cursor position using `f.set_cursor_position((x, y))` in ratatui.

---

## Review loops exposed silent adapter no-ops
**Date**: 2026-03-28
**What happened**: Code review repeatedly found adapter/backend methods that returned success while doing nothing (`formatSelection`, search overlays, selection collapse, scroll helpers). Those were expensive to notice late because local happy-path tests still passed.
**Recommendation**: For TUI adapter methods, prefer either a real implementation or an explicit unsupported error. Silent success makes review cycles longer and hides gaps until much later.

---

## Large Vim migration needed behavior-led debugging, not just typechecks
**Date**: 2026-03-28
**What happened**: The initial migration could typecheck and partially build while still breaking core behavior like insert mode, `Esc`, uppercase commands, and delete semantics. The fastest progress came from adding focused E2E probes for concrete user flows and tightening them as the behavior stabilized.
**Recommendation**: For large editor/input migrations, add small behavior-first E2E tests early and let them drive debugging. Do not rely on TypeScript/build success as a proxy for working input semantics.

---

## TUI Test requires delays after key presses
**Date**: 2026-03-28
**What happened**: Key press events weren't processed immediately by the app, causing cursor position assertions to fail. Tests needed `await new Promise((r) => setTimeout(r, 100))` after key presses.
**Recommendation**: Add delays after key presses in TUI Test to allow the app to process events. Use constants like `RENDER_DELAY_MS = 100` for maintainability.

---
