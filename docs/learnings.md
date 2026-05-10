# Learnings

## Large migrations need behavior-first E2E tests
**Date**: 2026-03-28
**Area**: testing
**What happened**: The Vim migration could typecheck while still breaking core behavior. The fastest progress came from focused E2E probes for concrete user flows.
**Takeaway**: For large editor/input migrations, add small behavior-first E2E tests early. Don't rely on TypeScript/build success as a proxy for working input semantics.

---

## Viewport scrolling changes cursor position interpretation
**Date**: 2026-04-13
**Area**: testing
**What happened**: `getCursor()` returns viewport position (0-26), not buffer position. After scrolling, these differ.
**Takeaway**: When writing cursor tests with scrolling, account for viewport offset. Cursor is at `cursor_row - scroll_top` within the viewport.

---

## adapter.dispatch (status-display/status-notify) may fail from within doReplace
**Date**: 2026-05-08
**Area**: testing
**What happened**: Calling `adapter.openNotification` or `showConfirm` from inside `doReplace` (specifically from `stop()` called via `replaceAll()`) did not produce visible notifications in E2E tests, despite working from the caller after `doReplace` returned. The root cause was never identified, but the fix was to return data from `doReplace` and call `showConfirm` from the substitute handler.
**Takeaway**: When dispatching status bar events from deep callbacks inside complex ex-command flows (especially inside `doReplace`), prefer returning the result data and dispatching from the calling handler. This avoids an apparent dispatch issue within the nested closure tree.

---

## Native NAPI calls from action/ex-command handlers need try/catch
**Date**: 2026-05-08
**Area**: architecture
**What happened**: Code-reviewer flagged multiple call sites where `#[napi]` Rust functions (which return `Result` and throw on failure) were called from TypeScript without error handling. Adding try/catch around every NAPI call site or extracting shared helpers (`doNextBuffer`/`doPrevBuffer`) was required.
**Takeaway**: Every `#[napi]` function can throw. Wrap direct calls in try/catch or route through a shared helper that handles errors. The code-reviewer treats missing error handling as a score-4+ issue.

---

