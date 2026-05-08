# Fix Status Bar Flicker During Cursor Movement

## Context

When holding `j` (or any motion key), the status bar file name and cursor position flicker — for a split frame the status bar shows stale content (old cursor position, or the key buffer shifting the filename). This is caused by two problems:

1. **Redundant intermediate renders**: Each keypress triggers 5 separate `render_frame_internal()` calls — `setCursorPos()` and `setSelection()` in Rust each call `render_frame_internal()` with the **old** `status_text` (the TypeScript status bar hasn't updated yet), producing frames where the editor shows the new cursor position but the status bar still shows the old line:col and the transient key buffer.

2. **Stale cursor position in status bar**: `clearInputState()` dispatches `vim-command-done` → `setKeyBuffer("")` → `update()` → `setStatusText()` **before** `updateCursorPos()` has updated `statusBar.cursorLine`/`statusBar.cursorCol`. This produces a frame where the status bar shows the old cursor position (e.g. `1:1`) while the cursor in the editor has already moved (e.g. to line 2).

The render sequence for a single `j` keypress is:
- Render #1: `setKeyBuffer("j")` → `setStatusText("NORMAL  j  file  1:1")` → render
- Render #2: `setCursorPos()` → render with stale status text `"NORMAL  j  file  1:1"` (cursor moved to line 2 in Rust state, but status bar still says 1:1)
- Render #3: `setSelection()` → render with same stale status text
- Render #4: `setKeyBuffer("")` (via `clearInputState`) → `setStatusText("NORMAL  file  1:1")` — **wrong cursor position** because `statusBar.cursorLine` is still 0
- Render #5: `updateCursorPos()` → `setCursorPos()` → `setStatusText("NORMAL  file  2:1")` — correct final state

Renders #2, #3, and #4 all show incorrect status bar content. When `j` is held down, this cycle repeats ~30–50 times/second, producing visible flicker.

## Out of Scope

- Changing vim key buffer display behavior (the key buffer should still appear briefly)
- Debouncing or batching `setStatusText()` calls at the Rust level
- Removing `render_frame_internal()` from less frequently called NAPI functions (`replace_range`, `replace_selections`, `indent_line`, `scroll_to`, `scroll_to_line`, `set_visual_mode`, `set_vim_mode`, `set_replace_mode`, `undo`, `redo`, `switch_to_buffer`, `load_file`)

## Implementation approach

### 1. Remove redundant renders from state-mutating NAPI functions

Remove `render_frame_internal()` calls from `set_cursor_pos()`, `set_selection()`, and `set_selections()` in `lib/src/tui/api.rs`. These functions mutate Rust state (cursor position, selection) but should not trigger a render — the render will be driven by `setStatusText()` which is always called after state updates via the TypeScript status bar.

This is safe because every code path that calls these functions is followed by a `setStatusText()` call (via `statusBar.setKeyBuffer()`, `statusBar.setCursorPos()`, `statusBar.setMode()`, or `statusBar.refresh()`). A `focusEditor()` call is added at the end of `processKeyEvent()` as a safety net for any edge case paths.

### 2. Make `TerminalStatusBar.update()` read cursor position from Rust state

Change `TerminalStatusBar.update()` to call `getCursorPos()` directly instead of relying on `this.cursorLine`/`this.cursorCol` which are only updated by `setCursorPos()`. This ensures that every `update()` call composes the status text with the **current** cursor position from Rust, eliminating the stale-cursor-position frame (render #4 above).

The `setCursorPos()` method is simplified to just call `update()` since the cursor position is now read fresh in `update()`. The `cursorLine`/`cursorCol` fields are removed since they're no longer the source of truth.

### 3. Add `focusEditor()` at end of `processKeyEvent()`

Add a `focusEditor()` call at the end of `processKeyEvent()` in `app/src/index.ts`. This ensures a final render happens after all state updates for each keypress, serving as a safety net for any code paths that don't go through `setStatusText()` (e.g., if the status bar is in prompt mode and `update()` returns early).

## Tasks

### Task 1 - Remove redundant renders from Rust NAPI functions

Remove `render_frame_internal()` calls from `set_cursor_pos`, `set_selection`, and `set_selections` in `lib/src/tui/api.rs`. Each function currently locks state, mutates it, drops the lock, then calls `render_frame_internal()`. Change each to only lock and mutate — remove the `render_frame_internal()` call after the lock scope.

- `set_cursor_pos` called with line=5, ch=3
  - → cursor moves to (5,3) in Rust state
  - → no render triggered (render happens when `setStatusText` is called next)
- `set_selection` called with anchor=(0,0), head=(5,3)
  - → selection updated in Rust state
  - → no render triggered
- `set_selections` called with multiple selections
  - → selections updated in Rust state
  - → no render triggered
- Existing E2E tests pass (cursor movement, visual mode, status bar)
  - → all assertions still pass because `setStatusText` or `focusEditor` drives the final render

### Task 2 - Read cursor position from Rust in `TerminalStatusBar.update()`

Modify `TerminalStatusBar.update()` in `app/src/vim/terminal-status-bar.ts` to call `getCursorPos()` and use the returned values instead of `this.cursorLine`/`this.cursorCol`. Remove the `cursorLine` and `cursorCol` fields. Simplify `setCursorPos()` to just call `update()`.

- `update()` called after cursor moved to line 5, col 3
  - → `getCursorPos()` returns `{ line: 5, ch: 3 }`
  - → status text includes `6:4` (1-indexed)
- `update()` called during prompt mode
  - → `getCursorPos()` is not called (prompt manages its own text via `setStatusText`)
  - → no change in prompt behavior
- `update()` called during notification
  - → `getCursorPos()` is not called (notification takes priority, returns early)
  - → no change in notification behavior
- `update()` called when TUI is shut down
  - → `getCursorPos()` throws, caught by the existing try/catch in `update()`
  - → no crash, best-effort behavior preserved
- Unit tests for `TerminalStatusBar` pass
  - → mock `getCursorPos` returns expected values
  - → status text assertions still pass

### Task 3 - Add `focusEditor()` safety-net render after key processing

Add `focusEditor()` call at the end of `processKeyEvent()` in `app/src/index.ts`, after `vimMode.handleKey(encodedKey)`. This ensures a render always happens even if the status bar is in prompt/notification/display mode and skips `update()`.

- Normal keypress (`j`) in normal mode
  - → `focusEditor()` called after `handleKey()` completes
  - → render shows final state (cursor moved, status bar updated)
- Keypress during prompt mode (`/` search)
  - → `focusEditor()` called after `handleKey()` returns (prompt handled key internally)
  - → render shows prompt text (no stale state)
- Resize event
  - → `focusEditor()` already called in resize handler
  - → no double-render issue (resize handler uses `continue` to skip normal key processing)

## Technical Context

- `getCursorPos()` is already imported in `terminal-status-bar.ts` (used in the constructor)
- `focusEditor()` is already imported in `index.ts` (used in resize handler)
- The `render_frame_internal()` function in `lib/src/tui/render.rs` reads `status_text` from `TuiState` — removing renders from state-mutating functions doesn't affect what gets rendered, only when
- Ratatui's `terminal.draw()` uses double buffering with diffing — only changed cells are written to the terminal, so reducing renders also reduces terminal I/O

## Notes

- The `set_cursor_pos` function currently returns `Result<CursorPosition>` — the return value is used by `adapter.setCursor()` to sync the TypeScript-side selection state. Removing `render_frame_internal()` does not affect the return value.
- The `set_selection` and `set_selections` functions currently return `Result<()>` — removing `render_frame_internal()` is a clean change.
- After this fix, the render sequence for a `j` keypress becomes:
  1. `setKeyBuffer("j")` → `setStatusText()` → render (shows key buffer + current cursor position)
  2. `setKeyBuffer("")` → `setStatusText()` → render (shows current cursor position, no key buffer)
  3. `focusEditor()` → render (final safety-net render, same state as #2)
  
  This is 3 renders instead of 5, and critically, **every render shows the correct cursor position** because `update()` reads it fresh from Rust state.