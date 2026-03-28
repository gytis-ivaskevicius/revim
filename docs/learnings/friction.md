# Friction

## Terminal cursor position requires explicit set
**Date**: 2026-03-28
**What happened**: E2E tests using `terminal.getCursor()` failed because the app wasn't setting the terminal cursor position. The app only rendered the cursor using reversed style, but didn't call `set_cursor_position()`.
**Recommendation**: When testing cursor position with TUI Test, ensure the app sets the terminal cursor position using `f.set_cursor_position((x, y))` in ratatui.

---

## TUI Test requires delays after key presses
**Date**: 2026-03-28
**What happened**: Key press events weren't processed immediately by the app, causing cursor position assertions to fail. Tests needed `await new Promise((r) => setTimeout(r, 100))` after key presses.
**Recommendation**: Add delays after key presses in TUI Test to allow the app to process events. Use constants like `RENDER_DELAY_MS = 100` for maintainability.

---