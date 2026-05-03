# Code Review Round-Two Fixes

## Context

A code review of commits 83b65f5..HEAD (committed at 99c03899) identified 15 issues across correctness, security, concurrency, and code quality. Story 016 addressed the first round of fixes (missing key mappings, swallowed errors, log formatting, chrono migration, closeLog, applyKeyToQuery, dispatchKey consolidation, highlightTimeout wrapper). This story addresses every remaining issue from the report: Ctrl-U case mismatch in the ex command handler, missing early return after close() in the ex command handler, inverted close-before-cleanup order, missing Insert key in decodeKey, compound modifier mishandling in decodeKey, unnecessary getter/setter for _highlightTimeout, decodeKey key-mapping duplication, dispatchKey leaking as public API, log path validation, fd validity check, Mutex poisoning recovery, keyboard queue unwrap, infinite error loop risk, and the close() dual-behavior API.

## Out of Scope

- Ctrl-C during search handling (deferred)
- Any new features beyond fixing the identified issues
- Unifying decodeKey/encodeTerminalKey into a shared module (future story)
- writeSync blocking the event loop (minor, debug-only facility; not worth the async refactor)

## Implementation approach

### Correctness

1. **Ctrl-U case mismatch (items 1/18)** — `command-dispatcher.ts:385` checks `keyName === "Ctrl-U"` (uppercase U), but `getEventKeyName` produces `"Ctrl-u"` (lowercase) because `normalizeCtrlCharacter` converts Ctrl+U to lowercase `"u"` before the `Ctrl-` prefix is added. The search prompt handler already uses lowercase `"Ctrl-u"` on line 285. Fix: change `"Ctrl-U"` to `"Ctrl-u"` on line 385.

2. **Ex command Esc handler lacks early return (items 2/19)** — After `close()` on line 376, execution falls through to the `if (keyName === "Up" || keyName === "Down")` check on line 379 and then the `else` branch on line 389, which resets `exCommandHistoryController`. The search prompt handler (lines 269-289) uses `if/else if/else if` to prevent this. Fix: restructure `onPromptKeyDown` in the ex command handler to use `if/else if/else if` like the search prompt handler, with early returns after each branch.

3. **Ex command handler calls close() after cleanup (item 3)** — The search prompt handler calls `close()` first (line 271), then does cleanup in a try-catch with the comment "Close prompt FIRST before any cleanup that might throw." The ex command handler does cleanup first (lines 372-377), then `close()` (line 376). If `clearInputState(adapter)` or `adapter.focus()` throws, the prompt won't be closed, leaving the UI in an inconsistent state. Fix: restructure to call `close()` first, then cleanup in try-catch, matching the search prompt pattern.

4. **decodeKey doesn't handle Insert key (item 4)** — `api.rs:113` maps `KeyCode::Insert` to `"Insert"`, but `decodeKey`'s `singleKeyMap` has no entry for `"Insert"`. Fix: add `Insert: "Insert"` to `singleKeyMap`.

5. **decodeKey mishandles compound modifiers like Shift-Ctrl-A (item 5)** — `encodeTerminalKey` can produce `"Shift-Ctrl-A"` when Shift+Ctrl+A is pressed. `decodeKey` tries `Shift-(.+)` first, which captures `"Ctrl-A"` as the key, producing `{ key: "Ctrl-A", shiftKey: true }` instead of `{ key: "A", ctrlKey: true, shiftKey: true }`. Fix: reorder the regex matches in `decodeKey` to check for compound modifiers first. Match `^(Ctrl|Alt|Shift)-(.+)$` patterns in a way that handles stacking: first strip all modifier prefixes, then set the corresponding boolean flags. Specifically, change `decodeKey` to use a loop or chained regex that strips `Ctrl-`, `Alt-`, `Shift-` prefixes from the front of the encoded key, setting the corresponding flags, until what remains is a bare key name or single character.

### Security

6. **openSync creates/truncates arbitrary file (item 9)** — `initLog` in `log.ts:7` calls `openSync(path, "w")` which creates or truncates any file at the given path. While the path comes from CLI args (not untrusted input), a user could accidentally overwrite a critical file. Fix: validate the path in `initLog` — require that it ends with `.log` extension and does not contain path traversal (`..`). If validation fails, throw an error with a clear message.

7. **unsafe File::from_raw_fd without fd validity check (item 10)** — `set_log_fd` in `log.rs:19` rejects negative fds but doesn't verify the fd refers to an open file. An invalid but non-negative fd would cause undefined behavior via `from_raw_fd`. Fix: add a validation check using `fcntl(fd, F_GETFD)` before calling `from_raw_fd`. If `fcntl` returns -1, the fd is invalid; return an error. Add `use std::os::unix::io::AsRawFd;` and call `libc::fcntl(fd, libc::F_GETFD)` or use `nix::fcntl::fcntl` — but to avoid adding a new dependency, use the `libc` crate which is already a transitive dependency of napi-rs. Actually, since we want to avoid adding dependencies, use `std::fs::File::from_raw_fd` only after validating with a simple `libc::fcntl` call. Since `libc` is already a transitive dep, add it explicitly to `Cargo.toml`.

### Concurrency

8. **LOG_FILE Mutex poisoning silently disables logging (item 11)** — `clear_log_fd` and `append_log` use `if let Ok(guard) = LOG_FILE.lock()`, silently dropping a poisoned lock. `set_log_fd` uses `unwrap_or_else(|e| e.into_inner())` which recovers. The asymmetry means logging can silently stop after a panic. Fix: make all three sites consistently recover from poisoning using `unwrap_or_else(|e| e.into_inner())`, matching `set_log_fd`'s pattern.

9. **WaitForKeyEvent::compute uses unwrap() on KEYBOARD_QUEUE.queue.lock() (item 12)** — If the mutex is poisoned, `unwrap()` will panic again, causing the NAPI task to fail. Fix: change `KEYBOARD_QUEUE.queue.lock().unwrap()` to `KEYBOARD_QUEUE.queue.lock().unwrap_or_else(|e| e.into_inner())` in `WaitForKeyEvent::compute`. Also apply the same fix to `start_keyboard_listener` which uses `.unwrap()` on line 128.

### Code quality

10. **Unnecessary getter/setter for _highlightTimeout (items 6/21)** — `_highlightTimeout` is only used within `search-utils.ts`, yet `getHighlightTimer()` and `setHighlightTimer()` expose it. The previous story (016) added these wrappers, but the review correctly identifies they add indirection with no encapsulation benefit since the variable is module-private. Fix: remove `getHighlightTimer` and `setHighlightTimer`, replace all call sites with direct `_highlightTimeout` access, and revert to a simple `let _highlightTimeout` variable.

11. **decodeKey duplicates key-mapping logic (item 7)** — `decodeKey` maintains its own key mapping table that must stay in sync with `encodeTerminalKey` in `terminal-key.ts` and the key codes in `api.rs`. Three separate locations must agree on key names. Fix: extract the `singleKeyMap` into a shared constant (e.g., `TERMINAL_KEY_MAP`) in `terminal-key.ts`, import it in `terminal-status-bar.ts`, and use it in `decodeKey` instead of a local duplicate. The modifier-stripping logic in `decodeKey` is different from `encodeTerminalKey` (it decodes rather than encodes), so it stays local, but the canonical key names come from one source.

12. **dispatchKey leaks as public API (items 8/22)** — `dispatchKey` is exported from `test-utils.ts` but is an implementation detail of `Keys`. Fix: remove the `export` keyword from `dispatchKey`, make it a module-level function used only by `Keys.keyPress` and `Keys.pressKey`. Any test files that import `dispatchKey` directly should be updated to use `Keys.keyPress` or `Keys.pressKey` instead.

13. **close() function has dual behavior (items 14/20)** — `close()` (no args) closes the prompt; `close(value)` sets the query without closing. This overloading is subtle — callers must know that `close("")` keeps the prompt open (for Ctrl-U) while `close()` closes it. Fix: split `close` into two functions: `closePrompt()` (no args, closes the prompt) and `setQuery(value: string)` (sets the query text without closing). Update all call sites in `command-dispatcher.ts` (search prompt and ex command handlers) and `terminal-status-bar.ts` (`handlePromptKey`). The `StatusBarInputOptions.onKeyDown` type signature changes from `close: (value?: string) => void` to `{ closePrompt: () => void; setQuery: (value: string) => void }`.

14. **Infinite error loop risk (item 13)** — If `processKeyEvent` throws on every key event, the main loop logs each error and continues, never terminating. Fix: add a circuit breaker — track consecutive errors in the main loop. After 10 consecutive errors, log a message and call `shutdown(1)` to exit. Reset the counter on any successful key processing.

## Tasks

### Task 1 - Fix Ctrl-U case mismatch in ex command handler

#### Acceptance Criteria

- `command-dispatcher.ts` ex command `onPromptKeyDown` checks `keyName === "Ctrl-u"` (lowercase) instead of `"Ctrl-U"`
- Pressing Ctrl+U in the `:` ex-command prompt clears the input text (verified by E2E test: type `:hello`, press Ctrl+U, assert prompt shows `:` with empty query)
- The search prompt handler's existing `"Ctrl-u"` check is unchanged

#### Non-Automatable

### Task 2 - Restructure ex command onPromptKeyDown with if/else if and close-first pattern

#### Acceptance Criteria

- `onPromptKeyDown` in the ex command handler uses `if/else if/else if` structure matching the search prompt handler pattern (no fall-through after `close()`)
- When Esc/Ctrl-C/Ctrl-[/Backspace-on-empty is matched, `close()` (or `closePrompt()` after Task 13) is called FIRST, then cleanup runs in a try-catch block
- When Up/Down is matched, `stopEvent(e)` is called and the branch returns (no fall-through to the else branch)
- When Ctrl-u is matched, `stopEvent(e)` is called and `setQuery("")` (or `close("")` before Task 13) is called
- The else branch resets `exCommandHistoryController` only when none of the above match
- E2E test: pressing Esc in `:` prompt closes the prompt and returns to normal mode
- E2E test: pressing Up/Down in `:` prompt navigates history without resetting the controller

#### Non-Automatable

### Task 3 - Add Insert key to decodeKey

#### Acceptance Criteria

- `decodeKey("Insert")` returns `{ key: "Insert", stopPropagation, preventDefault }` (not null)
- Existing key decodings (Enter, Escape, Backspace, Tab, Delete, Home, End, PageUp, PageDown, arrow keys, Ctrl-*, Alt-*, Shift-*, printable chars) still work correctly
- Unit test for `decodeKey("Insert")` returns non-null with `key === "Insert"`

#### Non-Automatable

### Task 4 - Fix compound modifier handling in decodeKey

#### Acceptance Criteria

- `decodeKey("Shift-Ctrl-A")` returns `{ key: "A", ctrlKey: true, shiftKey: true, ... }` (not `{ key: "Ctrl-A", shiftKey: true, ... }`)
- `decodeKey("Ctrl-Shift-A")` returns `{ key: "A", ctrlKey: true, shiftKey: true, ... }` (order-independent)
- `decodeKey("Alt-Ctrl-a")` returns `{ key: "a", altKey: true, ctrlKey: true, ... }`
- `decodeKey("Ctrl-a")` returns `{ key: "a", ctrlKey: true, ... }` (unchanged from current behavior)
- `decodeKey("Shift-Left")` returns `{ key: "Left", shiftKey: true, ... }` (unchanged)
- `decodeKey("Shift-Up")` returns `{ key: "Up", shiftKey: true, ... }` (unchanged)
- Single-modifier keys (Ctrl-a, Alt-b, Shift-Left) decode identically to before
- Unit tests cover: single Ctrl, single Shift with named key, compound Shift-Ctrl with letter, compound Ctrl-Shift with letter, compound Alt-Ctrl with letter

#### Non-Automatable

### Task 5 - Validate log file path in initLog

#### Acceptance Criteria

- `initLog("/etc/passwd")` throws an error (path does not end in `.log`)
- `initLog("../../../etc/passwd.log")` throws an error (path contains `..`)
- `initLog("/tmp/revim.log")` succeeds (valid path)
- `initLog("revim.log")` succeeds (relative valid path)
- Error messages clearly indicate the validation rule that was violated

#### Non-Automatable

### Task 6 - Validate fd in set_log_fd

#### Acceptance Criteria

- `set_log_fd(-1)` returns an error (existing behavior, unchanged)
- `set_log_fd(99999)` returns an error (fd does not refer to an open file) — validated via `fcntl(fd, F_GETFD)` returning -1
- `set_log_fd(valid_fd)` succeeds (existing behavior, unchanged)
- A new unit test passes a closed fd and verifies `set_log_fd` returns an error
- `libc` is added to `lib/Cargo.toml` `[dependencies]`

#### Non-Automatable

### Task 7 - Consistently recover from Mutex poisoning

#### Acceptance Criteria

- `clear_log_fd` uses `unwrap_or_else(|e| e.into_inner())` instead of `if let Ok(guard)` — recovering from poisoning rather than silently dropping
- `append_log` uses `unwrap_or_else(|e| e.into_inner())` instead of `if let Ok(guard)` — recovering from poisoning rather than silently dropping
- `is_logging_enabled` uses `unwrap_or_else(|e| e.into_inner())` instead of `if let Ok(guard)` — recovering from poisoning
- `set_log_fd` already uses `unwrap_or_else(|e| e.into_inner())` — unchanged
- `WaitForKeyEvent::compute` in `api.rs` uses `unwrap_or_else(|e| e.into_inner())` instead of `.unwrap()` for `KEYBOARD_QUEUE.queue.lock()`
- `start_keyboard_listener` in `api.rs` uses `unwrap_or_else(|e| e.into_inner())` instead of `.unwrap()` for `KEYBOARD_QUEUE.queue.lock()`
- Existing tests pass unchanged

#### Non-Automatable

### Task 8 - Remove unnecessary getter/setter for _highlightTimeout

#### Acceptance Criteria

- `getHighlightTimer` and `setHighlightTimer` are removed from `search-utils.ts`
- `_highlightTimeout` is a module-level `let` variable (not exported)
- `highlightSearchMatches` uses `_highlightTimeout` directly instead of `getHighlightTimer()`/`setHighlightTimer()`
- `cancelPendingHighlight` uses `_highlightTimeout` directly
- No other file imports `getHighlightTimer` or `setHighlightTimer` (verified by grep)
- Existing search E2E tests pass unchanged

#### Non-Automatable

### Task 9 - Extract shared key map constant for decodeKey

#### Acceptance Criteria

- A `TERMINAL_KEY_MAP` constant is exported from `terminal-key.ts` containing the canonical mapping of encoded key names to display names (e.g., `{ Space: " ", Enter: "Enter", Escape: "Escape", ... }`)
- `decodeKey` in `terminal-status-bar.ts` imports `TERMINAL_KEY_MAP` and uses it instead of a local `singleKeyMap`
- `encodeTerminalKey` in `terminal-key.ts` is updated to use `TERMINAL_KEY_MAP` for key name lookups where applicable (or at minimum, the map is verified to be consistent with `encodeTerminalKey`'s output)
- Adding a new key to `api.rs` requires updating only `TERMINAL_KEY_MAP` (single source of truth for key name mapping)
- Unit test: `decodeKey` round-trips all keys in `TERMINAL_KEY_MAP` correctly

#### Non-Automatable

### Task 10 - Un-export dispatchKey from test-utils

#### Acceptance Criteria

- `dispatchKey` is no longer exported from `test-utils.ts` (no `export` keyword)
- `dispatchKey` is still accessible within the module by `Keys.keyPress` and `Keys.pressKey`
- No test file imports `dispatchKey` directly (verified by grep)
- All existing E2E tests pass without modification

#### Non-Automatable

### Task 11 - Split close() into closePrompt() and setQuery()

#### Acceptance Criteria

- `StatusBarInputOptions.onKeyDown` signature changes from `close: (value?: string) => void` to two parameters: `closePrompt: () => void` and `setQuery: (value: string) => void`
- `handlePromptKey` in `terminal-status-bar.ts` creates `closePrompt` (sets `this.promptState = null` and calls `this.update()`) and `setQuery` (sets `state.query = value` and calls `setStatusText(state.prefix + value)`) as separate functions
- Search prompt `onPromptKeyDown` in `command-dispatcher.ts` uses `closePrompt()` where it previously called `close()` with no args, and `setQuery("")` where it previously called `close("")`
- Ex command `onPromptKeyDown` in `command-dispatcher.ts` uses `closePrompt()` and `setQuery()` similarly
- Search prompt `onPromptKeyUp` uses `setQuery(query)` where it previously called `close(query)` (setting query without closing)
- `applyKeyToQuery` is unchanged (it doesn't use `close`)
- E2E test: pressing Esc in `/` search prompt closes the prompt
- E2E test: pressing Ctrl-U in `/` search prompt clears the query text without closing the prompt
- E2E test: pressing Esc in `:` ex prompt closes the prompt

#### Non-Automatable

### Task 12 - Add circuit breaker for infinite error loop

#### Acceptance Criteria

- A `consecutiveErrors` counter is tracked in the main loop in `index.ts`
- On each successful key processing, `consecutiveErrors` is reset to 0
- On each caught error, `consecutiveErrors` is incremented
- When `consecutiveErrors >= 10`, `log("too many consecutive errors, shutting down")` is called and `shutdown(1)` is invoked
- Normal operation (no errors) is unaffected — the counter stays at 0
- A single transient error resets after the next successful key processing

#### Non-Automatable

## Technical Context

- `libc = "0.2"` (for `fcntl` fd validation) — already a transitive dependency at version 0.2.185 in the lockfile; adding it explicitly to `Cargo.toml` is safe
- No other new dependencies introduced
- `chrono 0.4` is already in `Cargo.toml` (added in story 016)
- `@microsoft/tui-test 0.0.3` is the E2E test framework

## Notes

- The `close()` → `closePrompt()`/`setQuery()` split (Task 11) should be implemented before or alongside Task 2, since Task 2's restructuring of `onPromptKeyDown` will reference the new function names
- Task 9 (shared key map) and Task 4 (compound modifier fix) can be implemented in the same PR since both modify `decodeKey`
- The circuit breaker threshold of 10 is chosen to allow transient errors (e.g., a single bad key event) without shutting down, while preventing an infinite loop from a persistent bug
- The `libc::fcntl` call in Task 6 is a single syscall — negligible performance impact
- Mutex poisoning recovery (Task 7) is defensive; in practice, none of the current code paths panic while holding these locks, but the consistent recovery strategy prevents silent failures if a future change introduces a panic