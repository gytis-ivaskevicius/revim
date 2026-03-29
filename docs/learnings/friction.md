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

## TUI Test worker reuse can contaminate later tests
**Date**: 2026-03-29
**What happened**: The full E2E suite produced blank-screen failures that looked like app regressions, but the root cause was TUI Test worker reuse/contamination when worker scheduling was too constrained. Raising the configured worker count stopped the cross-test contamination.
**Recommendation**: If TUI E2Es fail inconsistently with a blank `>` prompt or state leaking between cases, check `tui-test.config.ts` worker settings first before debugging application logic.

---

## Rust delta-based undo had complex position tracking issues
**Date**: 2026-03-29
**What happened**: Implementing undo/redo in Rust using delta-based history (storing each replace_range as separate entry) failed because insert mode typed each character as a separate entry with different positions. When undoing in reverse order, positions conflicted and corrupted the buffer.
**Recommendation**: For undo in this TUI, prefer snapshot-based approach in TypeScript rather than delta-based in Rust. Simpler and more reliable.

---
