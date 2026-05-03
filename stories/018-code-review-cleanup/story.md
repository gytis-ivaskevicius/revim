# Code Review Cleanup — Prompt Closing, shiftKey, History Consolidation

## Context

A focused code review of `app/src/vim/terminal-status-bar.ts`, `app/src/vim/command-dispatcher.ts`, `app/src/vim/common.ts`, and `app/src/index.ts` identified seven small but concrete issues: a double `onKeyUp` on Enter, a misleading `shiftKey` guard, an unnecessary key-name round-trip, duplicated history handling, two separate prompt-closing paths, an opaque timeout variable name, and an error circuit-breaker that resets too eagerly. This story addresses all of them.

## Out of Scope

- New features beyond the identified fixes
- Changes to `getEventKeyName` browser-event handling (the `"Escape" → "Esc"` conversion must remain for browser `KeyboardEvent` compatibility)
- Any changes to `doReplace` confirm-prompt behavior beyond explicit Enter handling

## Implementation approach

### Correctness

1. **Skip `onKeyUp` on Enter by unifying prompt closing** — `handlePromptKey` in `terminal-status-bar.ts` has two closing paths: `onKeyDown` returning `true` (for Esc/Backspace-empty) and a hard-coded Enter block at the bottom. When Enter is pressed, `onKeyUp` runs before the bottom block, causing search prompts to double-update highlights and reset history position. Fix:
   - Add `keyName === "Enter"` to `makePromptKeyDown`'s close condition
   - Update `handlePromptKey` so that when `onKeyDown` returns `true` and `evt.key === "Enter"`, it calls `onClose` before returning
   - Remove the bottom Enter block entirely
   - Add `case "Enter": return false` to `doReplace`'s `onPromptKeyDown` so the confirm prompt stays open (its `onClose` is already a no-op)

2. **Remove misleading `!evt.shiftKey` check** — `applyKeyToQuery` rejects printable chars when `shiftKey` is true, but `encodeTerminalKey` already strips the Shift modifier for printables (it returns `'A'` not `'Shift-A'`). The `shiftKey` flag is therefore never true for printable chars that reach this function. Fix: remove `&& !evt.shiftKey` from the printable-char branch.

### Simplicity

3. **Eliminate `decodeKey` → `getEventKeyName` round-trip** — `TERMINAL_KEY_MAP` maps both `Escape` and `Esc` to `"Escape"`. `decodeKey` returns `{ key: "Escape" }`, then `getEventKeyName` converts it back to `"Esc"`. Fix: change both entries in `TERMINAL_KEY_MAP` to map to `"Esc"`, eliminating the indirection.

4. **Consolidate search prompt history into `makePromptKeyDown`** — The search prompt's `onPromptKeyUp` handles Up/Down history inline (lines 281-310 in `command-dispatcher.ts`), while the ex command prompt uses `makePromptKeyDown`'s `onHistoryKey` option. Fix:
   - Add `onHistoryKey` to the search prompt's `makePromptKeyDown` call, delegating Up/Down to `vimGlobalState.searchHistoryController.nextMatch`
   - Remove Up/Down handling and the redundant history-reset logic from `onPromptKeyUp`
   - `onPromptKeyUp` retains only incremental-search update logic (`updateSearchQuery` / `clearSearchHighlight`)

5. **Unify prompt-closing paths** — Covered by Task 1 (moving Enter into `onKeyDown` and removing the bottom Enter block).

6. **Rename `_highlightTimeout`** — The leading underscore and generic name convey nothing. Fix: rename to `pendingHighlightTimeoutId` and update both `highlightSearchMatches` and `cancelPendingHighlight`.

### Other

7. **Fix `consecutiveErrors` counter** — A single successful keypress resets `consecutiveErrors` to 0, so intermittent failures never accumulate to 10. Fix: replace the counter with a time-based sliding window (`errorTimestamps: number[]`). On each error, push `Date.now()` and filter out entries older than 30 seconds. When the filtered array reaches length 10, log and call `shutdown(1)`. Extract the logic into a small `createErrorWindow(limit, windowMs)` factory so it is unit-testable with an injectable `now`.

## Tasks

### Task 1 — Unify prompt closing so Enter is handled by `onKeyDown`

#### Acceptance Criteria

- `makePromptKeyDown` returns `true` when `keyName === "Enter"`
- `makePromptKeyDown` still calls `stopEvent(e)` for Enter
- `handlePromptKey` calls `state.options.onClose?.(state.query)` when `onKeyDown` returns `true` and `evt.key === "Enter"`
- `handlePromptKey` does NOT call `onClose` when `onKeyDown` returns `true` for Esc/Ctrl-[/Backspace-on-empty
- The hard-coded Enter block (lines 122-127 in `terminal-status-bar.ts`) is removed
- `doReplace`'s `onPromptKeyDown` explicitly returns `false` for `keyName === "Enter"` (keeps confirm prompt open)
- E2E test: pressing Enter in `/` search prompt closes the prompt, executes search, and cursor moves to match
- E2E test: pressing Enter in `:` ex prompt closes the prompt and executes the command
- E2E test: pressing Esc in `/` search prompt closes the prompt without moving cursor or leaving highlights
- E2E test: pressing Esc in `:` ex prompt closes the prompt and returns to NORMAL mode

### Task 2 — Remove misleading `!evt.shiftKey` check from `applyKeyToQuery`

#### Acceptance Criteria

- `applyKeyToQuery` no longer checks `!evt.shiftKey` in the printable-char branch
- `applyKeyToQuery` still rejects keys with `ctrlKey`, `altKey`, or `metaKey`
- Unit test: `applyKeyToQuery({ key: "A", shiftKey: true }, "hello")` returns `"helloA"` (shift no longer blocks)
- Existing unit tests for `applyKeyToQuery` still pass

### Task 3 — Eliminate `decodeKey` → `getEventKeyName` round-trip

#### Acceptance Criteria

- `TERMINAL_KEY_MAP["Escape"]` is `"Esc"` (was `"Escape"`)
- `TERMINAL_KEY_MAP["Esc"]` is `"Esc"` (was `"Escape"`)
- `decodeKey("Escape")` returns `{ key: "Esc", ... }`
- `decodeKey("Esc")` returns `{ key: "Esc", ... }`
- `getEventKeyName(decodeKey("Escape"))` returns `"Esc"` (no double conversion)
- Unit test: round-trip for all named keys in `TERMINAL_KEY_MAP` via `getEventKeyName`

### Task 4 — Consolidate search prompt history into `makePromptKeyDown`

#### Acceptance Criteria

- Search prompt `onPromptKeyDown` is created with `onHistoryKey` that calls `vimGlobalState.searchHistoryController.nextMatch(input, up)` and `setQuery(match)`
- Search prompt `onPromptKeyUp` no longer contains Up/Down handling
- Search prompt `onPromptKeyUp` no longer resets `searchHistoryController` on non-Left/Right keys (reset is now in `makePromptKeyDown`)
- `onPromptKeyUp` still calls `updateSearchQuery` / `clearSearchHighlight` for incremental search
- E2E test: pressing Up in `/` search prompt recalls previous search query from history
- E2E test: pressing Down in `/` search prompt navigates forward in history

### Task 5 — Rename `_highlightTimeout` to `pendingHighlightTimeoutId`

#### Acceptance Criteria

- `let _highlightTimeout` in `search-utils.ts` is renamed to `let pendingHighlightTimeoutId`
- `highlightSearchMatches` references `pendingHighlightTimeoutId`
- `cancelPendingHighlight` references `pendingHighlightTimeoutId`
- No other file references `_highlightTimeout` (verified by grep)
- Existing search highlight behavior is unchanged

### Task 6 — Replace consecutive error counter with time-based sliding window

#### Acceptance Criteria

- `createErrorWindow(limit: number, windowMs: number)` factory exists and is unit-testable with an optional `now` parameter
- `index.ts` uses `createErrorWindow(10, 30000)` in the main loop
- 10 errors within 30 seconds calls `log("too many errors in sliding window, shutting down")` and `shutdown(1)`
- A successful keypress does NOT reset the error window (it slides naturally by time)
- Normal operation with no errors is unaffected
- Unit test: 10 rapid errors triggers shutdown signal
- Unit test: 5 errors, wait 31 seconds, 5 more errors does NOT trigger shutdown

## Technical Context

- No new dependencies introduced
- `bun:test` for unit tests, `@microsoft/tui-test` for E2E tests
- `makePromptKeyDown` is shared by search and ex-command prompts; any change affects both
- `doReplace` in `ex-commands.ts` has its own standalone `onPromptKeyDown`; it is the only prompt caller outside `command-dispatcher.ts`

## Notes

- Task 1 and Task 4 both touch search prompt `onKeyDown`/`onKeyUp`. Implement Task 1 first (unify closing), then Task 4 (move history).
- The `getEventKeyName` function must still convert `"Escape"` → `"Esc"` for browser `KeyboardEvent` objects; only the `decodeKey` output is changed to avoid the round-trip.
- `doReplace`'s `onClose` is intentionally `() => {}`; making Enter return `false` there preserves the current effective behavior (prompt stays open).
