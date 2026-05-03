# Acceptance Criteria — Code Review Cleanup

## Task 1 — Unify prompt closing so Enter is handled by `onKeyDown`

- [ ] `makePromptKeyDown` returns `true` when `keyName === "Enter"` and calls `stopEvent(e)`
- [ ] `handlePromptKey` calls `onClose` only when `onKeyDown` returns `true` **and** `evt.key === "Enter"`
- [ ] `handlePromptKey` does NOT call `onClose` for Esc/Ctrl-[/Backspace-on-empty
- [ ] Hard-coded Enter block removed from `terminal-status-bar.ts`
- [ ] `doReplace`'s `onPromptKeyDown` returns `false` for Enter
- [ ] E2E: `/` + query + Enter closes prompt and executes search
- [ ] E2E: `:` + command + Enter closes prompt and executes command
- [ ] E2E: `/` + Esc closes prompt without moving cursor or leaving highlights
- [ ] E2E: `:` + Esc closes prompt and returns to NORMAL mode

## Task 2 — Remove misleading `!evt.shiftKey` check

- [ ] `applyKeyToQuery` no longer checks `!evt.shiftKey`
- [ ] Unit test: `applyKeyToQuery({ key: "A", shiftKey: true }, "hello")` → `"helloA"`
- [ ] Existing `applyKeyToQuery` unit tests still pass

## Task 3 — Eliminate `decodeKey` → `getEventKeyName` round-trip

- [ ] `TERMINAL_KEY_MAP["Escape"]` and `TERMINAL_KEY_MAP["Esc"]` both map to `"Esc"`
- [ ] `decodeKey("Escape")` and `decodeKey("Esc")` return `{ key: "Esc" }`
- [ ] `getEventKeyName(decodeKey("Escape"))` returns `"Esc"` without double conversion
- [ ] Unit test covers round-trip for all named keys

## Task 4 — Consolidate search prompt history into `makePromptKeyDown`

- [ ] Search prompt uses `makePromptKeyDown` with `onHistoryKey` for Up/Down
- [ ] Search `onPromptKeyUp` no longer handles Up/Down or resets history controller
- [ ] Incremental search (`updateSearchQuery`) still works in `onPromptKeyUp`
- [ ] E2E: Up in `/` prompt recalls previous search from history
- [ ] E2E: Down in `/` prompt navigates forward in history

## Task 5 — Rename `_highlightTimeout`

- [ ] Variable renamed to `pendingHighlightTimeoutId`
- [ ] `highlightSearchMatches` and `cancelPendingHighlight` updated
- [ ] No other references to `_highlightTimeout` exist

## Task 6 — Replace consecutive error counter with sliding window

- [ ] `createErrorWindow(limit, windowMs)` factory exists with injectable `now`
- [ ] Main loop uses `createErrorWindow(10, 30000)`
- [ ] 10 errors within 30 seconds triggers `shutdown(1)`
- [ ] Successes do not reset the window
- [ ] Unit test: 10 rapid errors → shutdown
- [ ] Unit test: 5 errors + 31s wait + 5 errors → no shutdown
