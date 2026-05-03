# Code Review Round-Two Fixes

## Context

A code review of commits 83b65f5..HEAD (committed at 99c03899) identified issues across correctness, security, concurrency, and code quality. Story 016 addressed the first round of fixes. This story covers the remaining issues plus infrastructure improvements.

## Out of Scope

- Ctrl-C during search handling (deferred)
- Any new features beyond fixing the identified issues
- Unifying decodeKey/encodeTerminalKey into a shared module (future story)
- writeSync blocking the event loop (minor, debug-only facility; not worth the async refactor)

## Implementation approach

### Correctness

1. **Ctrl-U case mismatch** — `command-dispatcher.ts` ex command handler checks `keyName === "Ctrl-U"` (uppercase U), but `getEventKeyName` produces `"Ctrl-u"` (lowercase). The search prompt handler was already fixed to use lowercase in story 016. Fix: change `"Ctrl-U"` to `"Ctrl-u"` in the ex command handler.

2. **Ex command Esc handler lacks early return** — After `close()` fires, execution falls through to subsequent `if` blocks. The search prompt handler uses `if/else if/else if` to prevent this. Fix: restructure the ex command `onPromptKeyDown` to use `if/else if/else if` with early returns, matching the search prompt pattern.

3. **Ex command handler calls close() after cleanup** — The search prompt handler calls `close()` first, then does cleanup in a try-catch. The ex command handler does the opposite. If cleanup throws, the prompt isn't closed. Fix: call `close()` first, then cleanup in try-catch, matching the search prompt pattern.

4. **decodeKey doesn't handle Insert key** — `api.rs` maps `KeyCode::Insert` to `"Insert"` but `decodeKey` has no entry. Fix: Add `Insert` to `TERMINAL_KEY_MAP`.

5. **decodeKey mishandles compound modifiers** — `encodeTerminalKey` produces `"Shift-Ctrl-A"` but `decodeKey`'s sequential regex matching produces `{ key: "Ctrl-A", shiftKey: true }` instead of `{ key: "A", ctrlKey: true, shiftKey: true }`. Fix: replace sequential regex matching with a loop that strips all modifier prefixes one by one, setting the corresponding boolean flags.

### Concurrency

6. **LOG_FILE Mutex poisoning silently disables logging** — `clear_log_fd` and `append_log` use `if let Ok(guard)` which silently drops a poisoned lock. `set_log_fd` uses `unwrap_or_else(|e| e.into_inner())` which recovers. Fix: make all sites consistently use `unwrap_or_else(|e| e.into_inner())`.

7. **WaitForKeyEvent unwrap on poisoned mutex** — `KEYBOARD_QUEUE.queue.lock().unwrap()` panics if the mutex is poisoned. Fix: use `unwrap_or_else(|e| e.into_inner())` in `WaitForKeyEvent::compute` and `start_keyboard_listener`.

### Code quality

8. **Remove unnecessary getter/setter for _highlightTimeout** — Story 016 added `getHighlightTimer()`/`setHighlightTimer()` wrap a module-private variable, adding indirection with no encapsulation benefit. Fix: remove the accessor functions and access `_highlightTimeout` directly.

9. **Extract shared key map for decodeKey** — `decodeKey` maintained its own `singleKeyMap` table that must stay in sync with `encodeTerminalKey` in `terminal-key.ts` and the key codes in `api.rs`. Fix: extract `TERMINAL_KEY_MAP` into `terminal-key.ts` as a shared constant, import it in `terminal-status-bar.ts`.

10. **Un-export dispatchKey from test-utils** — `dispatchKey` is an implementation detail of the `Keys` helper. Fix: remove the `export` keyword.

11. **Simplify close() to single setQuery callback with return-value closing** — The current callback signature `close(value?: string): void` conflates two operations: updating query text and closing the prompt. The previous closePrompt/setQuery split made this worse by threading two separate function parameters. Fix:
    - Change `onKeyDown` signature: replace `close: (value?: string) => void` with `setQuery: (value: string) => void`
    - Return `true` from `onKeyDown` to signal "close the prompt", `false` (or undefined) to keep it open
    - The status bar's `handlePromptKey` closes the prompt when `onKeyDown` returns `true`
    - This keeps one clean callback, uses the return value for lifecycle control (a common UI pattern), and eliminates the ambiguous `close("")` pattern

12. **Add circuit breaker for infinite error loop** — If `processKeyEvent` throws on every key event, the main loop never terminates. Fix: track consecutive errors in the main loop; after 10 consecutive errors, log a message and call `shutdown(1)`.

### Infrastructure & documentation

13. **Fix E2E test infrastructure** — The `@microsoft/tui-test` framework crashes during transpilation of `app/tests/unit/terminal-status-bar.test.js` due to ESM module resolution issues (imports without `.js` extensions). Fix: configure tui-test to exclude unit test files, or add `.js` extensions to imports in the unit test file, whichever resolves the crash.

14. **Write missing E2E tests** — Task 2 requires E2E tests for Esc and Up/Down in the `:` command prompt. These are currently uncovered.

15. **Parameterize decodeKey unit tests** — Story 016 added ~20 individual decodeKey tests that are nearly identical (`decodeKey('X') returns { key: 'X' }`). Story 017 adds more compound modifier tests. Consolidate all decodeKey tests into data-driven loops (parameterized via `for` or `test.each`) to reduce codebase size and improve maintainability.

16. **Update AGENTS.md** — The project uses `bun`, not `node`/`npm`. Document how to run:
    - Linter: `npx biome check app/`
    - Formatter: `npx biome format --write app/`
    - TypeScript typecheck: `npx tsc --noEmit`
    - Unit tests: `bun test app/tests/unit/`
    - E2E tests: detailed instructions
    - Rust tests: `cargo test`
    - Rust linter: `cargo clippy -- -D warnings`

## Tasks

### Task 1 - Fix Ctrl-U case mismatch in ex command handler

#### Acceptance Criteria

- `command-dispatcher.ts` ex command `onPromptKeyDown` checks `keyName === "Ctrl-u"` (lowercase) instead of `"Ctrl-U"`
- Pressing Ctrl+U in the `:` ex-command prompt clears the input text (verified by E2E test)
- The search prompt handler's existing `"Ctrl-u"` check is unchanged

### Task 2 - Restructure ex command onPromptKeyDown with if/else if and close-first pattern

#### Acceptance Criteria

- `onPromptKeyDown` in the ex command handler uses `if/else if/else if` structure (no fall-through after closing)
- When Esc/Ctrl-C/Ctrl-[/Backspace-on-empty is matched, prompt is closed FIRST, then cleanup runs in a try-catch block
- When Up/Down is matched, `stopEvent(e)` is called and `setQuery` is used to update the input text (no fall-through to else)
- When Ctrl-u is matched, `stopEvent(e)` is called and `setQuery("")` clears the input without closing
- The else branch resets `exCommandHistoryController` only when none of the above match
- E2E test: pressing Esc in `:` prompt closes the prompt and returns to normal mode
- E2E test: pressing Up/Down in `:` prompt navigates history without resetting the controller

### Task 3 - Add Insert key to decodeKey

#### Acceptance Criteria

- `decodeKey("Insert")` returns `{ key: "Insert", stopPropagation, preventDefault }` (not null)
- Existing key decodings still work correctly
- Unit test for `decodeKey("Insert")` returns non-null with `key === "Insert"`

### Task 4 - Fix compound modifier handling in decodeKey

#### Acceptance Criteria

- `decodeKey("Shift-Ctrl-A")` returns `{ key: "A", ctrlKey: true, shiftKey: true, ... }` (not `{ key: "Ctrl-A", shiftKey: true, ... }`)
- `decodeKey("Ctrl-Shift-A")` returns `{ key: "A", ctrlKey: true, shiftKey: true, ... }` (order-independent)
- `decodeKey("Alt-Ctrl-a")` returns `{ key: "a", altKey: true, ctrlKey: true, ... }`
- Single-modifier keys (Ctrl-a, Alt-b, Shift-Left) decode identically to before
- Unit tests use parameterized/data-driven approach for compound modifier cases

### Task 5 - Consistently recover from Mutex poisoning

#### Acceptance Criteria

- `clear_log_fd` uses `unwrap_or_else(|e| e.into_inner())` instead of `if let Ok(guard)`
- `append_log` uses `unwrap_or_else(|e| e.into_inner())` instead of `if let Ok(guard)`
- `is_logging_enabled` uses `unwrap_or_else(|e| e.into_inner())` instead of `if let Ok(guard)`
- `WaitForKeyEvent::compute` in `api.rs` uses `unwrap_or_else(|e| e.into_inner())` instead of `.unwrap()` for `KEYBOARD_QUEUE.queue.lock()`
- `start_keyboard_listener` in `api.rs` uses `unwrap_or_else(|e| e.into_inner())` instead of `.unwrap()` for `KEYBOARD_QUEUE.queue.lock()`
- Existing tests pass unchanged

### Task 6 - Remove unnecessary getter/setter for _highlightTimeout

#### Acceptance Criteria

- `getHighlightTimer` and `setHighlightTimer` are removed from `search-utils.ts`
- `_highlightTimeout` is a module-level `let` variable (not exported)
- `highlightSearchMatches` and `cancelPendingHighlight` use `_highlightTimeout` directly
- No other file imports `getHighlightTimer` or `setHighlightTimer` (verified by grep)

### Task 7 - Extract shared key map constant for decodeKey

#### Acceptance Criteria

- A `TERMINAL_KEY_MAP` constant is exported from `terminal-key.ts` containing the canonical mapping of encoded key names to display names
- `decodeKey` in `terminal-status-bar.ts` imports `TERMINAL_KEY_MAP` and uses it instead of a local `singleKeyMap`
- Adding a new key to `api.rs` requires updating only `TERMINAL_KEY_MAP` (single source of truth)
- Unit test: `decodeKey` round-trips all keys in `TERMINAL_KEY_MAP` correctly

### Task 8 - Un-export dispatchKey from test-utils

#### Acceptance Criteria

- `dispatchKey` is no longer exported from `test-utils.ts`
- `dispatchKey` is still accessible within the module by `Keys.keyPress` and `Keys.pressKey`
- No test file imports `dispatchKey` directly (verified by grep)

### Task 9 - Simplify close() to setQuery + return-value closing

#### Acceptance Criteria

- `StatusBarInputOptions.onKeyDown` signature changes from `close: (value?: string) => void` to `setQuery: (value: string) => void` as the third parameter
- Returning `true` from `onKeyDown` signals the status bar to close the prompt
- Returning `false` or `undefined` keeps the prompt open
- `handlePromptKey` in `terminal-status-bar.ts` calls `onKeyDown`, then closes the prompt if the return value is truthy
- `setQuery` only updates the query text — it does not close the prompt
- Search prompt `onPromptKeyDown`:
  - Esc/Ctrl-[ /Backspace-on-empty: calls `setQuery` if needed, returns `true` (close)
  - Ctrl-u: calls `setQuery("")`, returns `false` (stay open)
  - Up/Down: calls `setQuery(match)`, returns `false` (stay open)
  - Default: returns `false`
- Ex command `onPromptKeyDown`:
  - Esc/Ctrl-C/Ctrl-[/Backspace-on-empty: calls cleanup, returns `true` (close)
  - Up/Down: calls `setQuery(input)`, returns `false` (stay open)
  - Ctrl-u: calls `setQuery("")`, returns `false` (stay open)
  - Default: returns `false`
- Search prompt `onPromptKeyUp` uses `setQuery(query)` instead of old `close(query)`
- `applyKeyToQuery` is unchanged
- E2E test: pressing Esc in `/` search prompt closes the prompt
- E2E test: pressing Ctrl-U in `/` search prompt clears the query text without closing the prompt
- E2E test: pressing Esc in `:` ex prompt closes the prompt

### Task 10 - Add circuit breaker for infinite error loop

#### Acceptance Criteria

- A `consecutiveErrors` counter is tracked in the main loop in `index.ts`
- On each successful key processing, `consecutiveErrors` is reset to 0
- On each caught error, `consecutiveErrors` is incremented
- When `consecutiveErrors >= 10`, `log("too many consecutive errors, shutting down")` is called and `shutdown(1)` is invoked
- Normal operation (no errors) is unaffected

### Task 11 - Fix E2E test infrastructure

#### Acceptance Criteria

- The `@microsoft/tui-test` framework no longer crashes on unit test files
- Unit tests run independently of E2E test infrastructure
- `bun test app/tests/unit/` passes all tests

### Task 12 - Write missing E2E tests for Task 2

#### Acceptance Criteria

- E2E test: pressing Esc in `:` command prompt closes the prompt and returns to normal mode
- E2E test: pressing Up in `:` command prompt navigates history (if history exists)
- E2E test: pressing Down in `:` command prompt navigates history (if history exists)

### Task 13 - Parameterize decodeKey unit tests

#### Acceptance Criteria

- The ~20 individual `decodeKey('X') returns { key: 'X' }` tests from story 016 are consolidated into data-driven loops
- The compound modifier tests from Task 4 use the same parameterized pattern
- All test coverage is preserved (same cases, same assertions)
- Test file size is reduced compared to 20+ individual test() calls

### Task 14 - Update AGENTS.md

#### Acceptance Criteria

- AGENTS.md documents that the project uses `bun` (not `node`/`npm`)
- All commands in AGENTS.md reference the `Justfile` as the repository entrypoint (e.g., `just dev`, `just test`, `just lint`, `just lint-fix`) rather than raw `bun`/`cargo`/`npx` commands
- Raw commands may be shown as alternatives or for reference, but `just` is the primary interface
- AGENTS.md includes a link to the Justfile (`./Justfile`) at the start of the "How to run" section
- Gotchas section documents known infrastructure issues (tui-test flakes, mutex deadlock, return-value prompt closing)

## Technical Context

- `chrono 0.4` is already in `Cargo.toml` (added in story 016)
- `@microsoft/tui-test 0.0.3` is the E2E test framework
- No new dependencies introduced
- The `libc` crate, log path validation, and fd validity checks discussed in earlier versions of this story were deemed unnecessary for a CLI debug tool — removed from scope

## Notes

- Task 9 (setQuery + return-value closing) replaces the earlier closePrompt/setQuery split approach. The return-value pattern is simpler: one callback parameter, no ambiguity about what "close" means, and consistent with common UI patterns.
- The circuit breaker threshold of 10 allows transient errors while preventing infinite loops from persistent bugs.
- E2E tests use `@microsoft/tui-test` which has known infrastructure issues (ESM resolution). Task 11 fixes this so tests can actually run.
- Parameterized tests reduce codebase size and make adding new test cases trivial — important since the decodeKey test file is growing.
