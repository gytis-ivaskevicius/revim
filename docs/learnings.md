# Learnings


## Large migrations need behavior-first E2E tests
**Date**: 2026-03-28
**Area**: testing
**What happened**: The Vim migration could typecheck while still breaking core behavior. The fastest progress came from focused E2E probes for concrete user flows.
**Takeaway**: For large editor/input migrations, add small behavior-first E2E tests early. Don't rely on TypeScript/build success as a proxy for working input semantics.


---

## Rust unit tests race on shared global state
**Date**: 2026-04-14
**Area**: rust/testing
**What happened**: Logging module used a `static Mutex<Option<...>>` and three unit tests interfered when run in parallel.
**Takeaway**: When writing Rust unit tests that access shared statics, use `#[serial]` attribute or `--test-threads=1`.

---

## Viewport scrolling changes cursor position interpretation
**Date**: 2026-04-13
**Area**: testing
**What happened**: `getCursor()` returns viewport position (0-26), not buffer position. After scrolling, these differ.
**Takeaway**: When writing cursor tests with scrolling, account for viewport offset. Cursor is at `cursor_row - scroll_top` within the viewport.

---

## ManuallyDrop with file descriptors requires into_raw_fd
**Date**: 2026-04-14
**Area**: rust
**What happened**: `ManuallyDrop::into_inner(file).as_raw_fd()` causes double-close. The temporary File drops at `;`, closing the fd, then `libc::close` closes it again.
**Takeaway**: Use `into_raw_fd()` (consuming without Drop) rather than `as_raw_fd()` (borrows, value still drops).

---

## Testable utilities must go in side-effect-free modules
**Date**: 2026-05-04
**Area**: testing
**What happened**: `createErrorWindow` was initially placed in `index.ts` (which has top-level side effects like `initTui()`). Unit tests importing it crashed because `index.ts` tried to initialize the terminal outside the TUI test environment.
**Takeaway**: Any function that needs unit testing must live in a dedicated module with no top-level side effects. Do not put testable utilities in `index.ts` or any module that calls `initTui`, `startKeyboardListener`, or other terminal APIs at import time. Create a separate `*.ts` file even for small utilities.
---

## Ex commands must be registered in `defaultExCommandMap`
**Date**: 2026-05-08
**Area**: workflow
**What happened**: Adding `bnext`/`bprev` to `exCommands` was insufficient — `:bnext` and `:bprev` silently failed because they weren't registered in `defaultExCommandMap` in `ex-command-dispatcher.ts`. The command map is built at construction time from this array.
**Takeaway**: All new ex commands need entries in both `exCommands` (behavior) and `defaultExCommandMap` (registration). The shortName field controls prefix matching (e.g. `"bn"` for `"bnext"`).

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

