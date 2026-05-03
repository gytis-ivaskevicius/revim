# Code Review Fixes (83b65f5..HEAD)

## Context

A code review of commits 83b65f5..HEAD identified correctness bugs, a performance issue, and several code-quality concerns. This story addresses all items except Ctrl-C during search and the `--log` path security issue (explicitly excluded). The fixes are sequenced: correctness bugs first, then performance, then code quality.

## Out of Scope

- Ctrl-C during search handling
- `--log` path security (symlink/traversal)
- Any new features beyond fixing the identified issues

## Implementation approach

### Correctness

1. **Missing key mappings in `decodeKey`** — Add `Tab`, `Delete`, `Home`, `End`, `PageUp`, `PageDown`, and `Shift-` prefixed keys to the `singleKeyMap` and modifier-match logic in `terminal-status-bar.ts:decodeKey`. The `encodeTerminalKey` function in `terminal-key.ts` already produces these encoded forms (e.g. `"Shift-Left"`, `"Tab"`, `"Delete"`), so `decodeKey` must be able to round-trip them. The `Shift-` prefix is already handled by `encodeTerminalKey` for non-printable keys (line 38-39), so `decodeKey` needs a `shiftKey: true` branch analogous to the existing `ctrlKey`/`altKey` ones.

2. **Empty try/catch in `onPromptClose`** — Replace the bare `catch (_e) {}` in `command-dispatcher.ts:220-224` with `log("search prompt error:", _e)` so errors from `handleQuery` are recorded. The `log` function is a no-op when logging is disabled, so this has zero overhead in production.

### Performance

3. **Eager string formatting in `revim_log!` macro** — Change the macro to check whether logging is enabled before formatting. Add a `fn is_logging_enabled() -> bool` that locks `LOG_FILE` and checks `is_some()`. Rewrite the macro to call `is_logging_enabled()` first and only call `append_log(&format!(…))` when true. This avoids allocating a formatted string on every log call when no log file is open.

### Code quality

4. **Replace custom Gregorian calendar with `chrono`** — Add `chrono = "0.4"` to `lib/Cargo.toml` dependencies. Replace the `format_timestamp` function body (~40 lines) with `chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()`. Remove the `is_leap_year` helper. The current code computes UTC timestamps from `UNIX_EPOCH` and appends `Z`, so `chrono::Utc` preserves that semantics. Remove `use std::time::{SystemTime, UNIX_EPOCH}`. Update the existing regex in `test_set_log_fd_and_append` — it already matches `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z`, so no change needed there.

5. **Add `closeLog()` and call during shutdown** — Add `closeLog()` to `app/src/log.ts` that closes `logFd` (via `closeSync`) and sets `logFd = null`. Export it. Call `closeLog()` in `index.ts` cleanup function, after `log("revim shutdown")` and before `shutdownTui()` returns (the fd must stay open for Rust-side flush during shutdown, so close after the final log message).

6. **Extract `applyKeyToQuery` helper** — In `terminal-status-bar.ts`, extract the character-input logic from `handlePromptKey` (lines 98-101) into a pure function `applyKeyToQuery(evt: StatusBarKeyEvent, query: string): string` that returns the new query string. This makes the key-to-query mapping testable in isolation without needing a `TerminalStatusBar` instance.

7. **Consolidate `dispatchKey` and `Keys.pressKey`** — `dispatchKey` (lines 34-72) and `Keys.pressKey` (lines 107-117) both translate symbolic key names to terminal method calls. Merge them: make `dispatchKey` the single source of truth, have `Keys.pressKey` delegate to it, and remove the duplicated key-name branches from `Keys.pressKey`. The `Keys.pressKey` method should call `dispatchKey` first; if it returns `true`, return early; otherwise fall through to `terminal.keyPress(key)`.

8. **Wrap `highlightTimeout` in a function** — Replace the module-level `let highlightTimeout` in `search-utils.ts:266` with a `getHighlightTimer()` / `setHighlightTimer()` pair backed by a closure or a small object, eliminating the mutable module-level variable.

## Tasks

### Task 1 - Add missing key mappings to `decodeKey`

#### Acceptance Criteria

- `decodeKey("Tab")` returns `{ key: "Tab", … }` (not null)
- `decodeKey("Delete")` returns `{ key: "Delete", … }` (not null)
- `decodeKey("Home")` returns `{ key: "Home", … }` (not null)
- `decodeKey("End")` returns `{ key: "End", … }` (not null)
- `decodeKey("PageUp")` returns `{ key: "PageUp", … }` (not null)
- `decodeKey("PageDown")` returns `{ key: "PageDown", … }` (not null)
- `decodeKey("Shift-Left")` returns `{ key: "Left", shiftKey: true, … }` (not null)
- `decodeKey("Shift-Right")` returns `{ key: "Right", shiftKey: true, … }` (not null)
- `decodeKey("Shift-Up")` returns `{ key: "Up", shiftKey: true, … }` (not null)
- `decodeKey("Shift-Down")` returns `{ key: "Down", shiftKey: true, … }` (not null)
- Existing keys (`Enter`, `Escape`, `Backspace`, arrow keys, `Ctrl-*`, `Alt-*`, printable chars) still decode correctly
- Delete key in search prompt deletes the character after the cursor position (or at minimum is not silently dropped)

#### Non-Automatable

- Visual verification that Tab key in search prompt does not crash or freeze the editor

### Task 2 - Log errors in `onPromptClose` instead of swallowing

#### Acceptance Criteria

- `onPromptClose` calls `log("search prompt error:", _e)` in the catch block instead of ignoring the error
- When logging is disabled, the `log` call is a no-op (verified by existing `log.ts` behavior: `logFd === null` → early return)
- When logging is enabled, a failing `handleQuery` writes the error to the log file

#### Non-Automatable

### Task 3 - Skip log formatting when logging is disabled

#### Acceptance Criteria

- `revim_log!` macro checks `is_logging_enabled()` before calling `format!`
- When no log file is open, `revim_log!("test")` does not allocate a formatted string (verified by reading the macro expansion)
- Existing `append_log` tests still pass
- A new unit test confirms that `is_logging_enabled()` returns `false` when no fd is set and `true` after `set_log_fd` is called with a valid fd

#### Non-Automatable

### Task 4 - Replace custom Gregorian calendar with `chrono`

#### Acceptance Criteria

- `lib/Cargo.toml` includes `chrono = "0.4"` in `[dependencies]`
- `format_timestamp` uses `chrono::Utc::now().format(...)` instead of manual calendar arithmetic
- `is_leap_year` function is removed
- `use std::time::{SystemTime, UNIX_EPOCH}` is removed from `log.rs`
- Existing `test_set_log_fd_and_append` test passes unchanged (timestamp format is identical)
- A new unit test verifies `format_timestamp` output matches the regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`

#### Non-Automatable

### Task 5 - Add `closeLog()` and call during shutdown

#### Acceptance Criteria

- `closeLog()` is exported from `app/src/log.ts`
- `closeLog()` calls `closeSync(logFd)` and sets `logFd = null`
- `closeLog()` is a no-op when `logFd` is already `null`
- `index.ts` calls `closeLog()` in the `cleanup` function, after `log("revim shutdown")` and before `shutdownTui()`
- When `--log` is not passed, `closeLog()` is still safe to call (no-op)

#### Non-Automatable

### Task 6 - Extract `applyKeyToQuery` helper

#### Acceptance Criteria

- A new exported function `applyKeyToQuery(evt: StatusBarKeyEvent, query: string): string` exists in `terminal-status-bar.ts`
- `applyKeyToQuery` returns a new query string: if `evt.key === "Backspace"` and `query.length > 0`, returns `query.slice(0, -1)`; if `evt.key` is a single printable character (length 1, no modifier keys), returns `query + evt.key`; otherwise returns `query` unchanged
- `handlePromptKey` calls `applyKeyToQuery` instead of inlining the logic
- A unit test for `applyKeyToQuery` covers: Backspace with non-empty query, Backspace with empty query, printable character, modifier key (Ctrl-a), non-printable key (Escape)

#### Non-Automatable

### Task 7 - Consolidate `dispatchKey` and `Keys.pressKey`

#### Acceptance Criteria

- `dispatchKey` is the single source of truth for mapping symbolic key names to terminal method calls
- `Keys.pressKey` delegates to `dispatchKey` first; if `dispatchKey` returns `true`, `Keys.pressKey` returns early
- `Keys.pressKey` no longer contains duplicated key-name branches that already exist in `dispatchKey`
- All existing E2E tests pass without modification
- `dispatchKey` is exported from `test-utils.ts` so it can be used by `Keys.pressKey`

#### Non-Automatable

### Task 8 - Wrap `highlightTimeout` in a function

#### Acceptance Criteria

- Module-level `let highlightTimeout` is removed from `search-utils.ts`
- A `getHighlightTimer()` function returns the current timer (or `undefined`)
- A `setHighlightTimer(timer)` function stores the timer
- `highlightSearchMatches` and `cancelPendingHighlight` use these functions instead of the module-level variable
- Existing search E2E tests pass unchanged

#### Non-Automatable

## Technical Context

- `chrono = "0.4"` (latest stable: 0.4.44) — widely used Rust datetime crate; `chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3f")` produces the same timestamp format as the current manual implementation
- No other new dependencies introduced

## Notes

- The `decodeKey` function and `encodeTerminalKey` are not yet unified into a shared module (item 5 from the review). This story adds the missing mappings to `decodeKey` to fix the correctness bug; a future story may refactor them into a shared key-encoding module.
- The `closeLog()` call in `index.ts` must happen after the final `log("revim shutdown")` call, because the Rust side may still flush data to the fd during `shutdownTui()`. The fd is owned by the TS process (opened via `openSync`), so closing it after the final log write is safe.