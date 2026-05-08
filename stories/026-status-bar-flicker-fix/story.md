# Fix Status Bar Flicker During Cursor Movement

## Context

When holding `j` (or any motion key), the status bar flickers — for a split frame it shows stale content (old cursor position, transient key buffer). This is caused by multiple redundant renders per keypress that show intermediate state:

The render sequence for a single `j` keypress is:
1. `setKeyBuffer("j")` → `setStatusText("NORMAL  j  file.txt  1:1")` → **render** (key buffer shown, old cursor pos)
2. `setCursorPos()` → **render** with stale status text `"NORMAL  j  file.txt  1:1"` (cursor moved in Rust but status bar still says 1:1)
3. `setSelection()` → **render** with same stale status text
4. `clearInputState` → `setKeyBuffer("")` → `setStatusText("NORMAL  file.txt  1:1")` → **render** (key buffer gone, but cursor pos still wrong because `clearInputState` fires before `adapter.setCursor()`)
5. `updateCursorPos()` → `setCursorPos()` → `setStatusText("NORMAL  file.txt  2:1")` → **render** (correct final state)

Renders #2, #3, and #4 show incorrect status bar content. When `j` is held down, this cycle repeats ~30–50 times/second, producing visible flicker where the filename position jumps and the cursor position number is wrong.

## Out of Scope

- Changing vim key buffer display behavior (the key buffer should still appear briefly)
- Removing `render_frame_internal()` from less frequently called NAPI functions (`replace_range`, `replace_selections`, `indent_line`, `scroll_to`, `scroll_to_line`, `set_visual_mode`, `set_vim_mode`, `set_replace_mode`, `undo`, `redo`, `switch_to_buffer`, `load_file`)

## Implementation approach

### 1. Remove `render_frame_internal()` from state-mutating NAPI functions

Remove `render_frame_internal()` calls from `set_cursor_pos()`, `set_selection()`, and `set_selections()` in `lib/src/tui/api.rs`. These functions mutate Rust state (cursor position, selection) but should not trigger a render — the render will be driven by `setStatusText()` or `focusEditor()`.

### 2. Remove `render_frame_internal()` from `setStatusText()`

Remove the `render_frame_internal()` call from `set_status_text()` in `lib/src/tui/api.rs`. Change it to only update `state.status_text` without rendering. This is the key change — it eliminates renders #1 and #4 from the sequence above, which show stale intermediate state (key buffer appearing/disappearing, wrong cursor position).

All rendering is now driven by `focusEditor()` at the end of `processKeyEvent()`, which calls `render_frame_internal()` once with the final correct state.

### 3. Make `TerminalStatusBar.update()` read cursor position from Rust state

Change `TerminalStatusBar.update()` to call `getCursorPos()` directly instead of relying on `this.cursorLine`/`this.cursorCol`. This ensures that when `update()` is called (e.g., from `focusEditor()` → `statusBar.refresh()`), it always composes the status text with the current cursor position from Rust, not a stale cached value.

Remove the `cursorLine` and `cursorCol` fields. Simplify `setCursorPos()` to just call `update()`.

### 4. Add `focusEditor()` at end of `processKeyEvent()`

Add a `focusEditor()` call at the end of `processKeyEvent()` in `app/src/index.ts`. This is now the **sole driver of rendering** during key processing. Since `setStatusText()` no longer renders, `focusEditor()` ensures a single render per keypress with the final correct state.

### Why this works

After all four changes, the render sequence for a `j` keypress becomes:
1. `setKeyBuffer("j")` → `setStatusText(...)` → **no render** (just updates Rust state)
2. `clearInputState` → `setKeyBuffer("")` → `setStatusText(...)` → **no render** (just updates Rust state)
3. `adapter.setCursor()` → `setCursorPos()` → **no render** (just updates Rust state)
4. `adapter.syncSelection()` → `setSelection()` → **no render** (just updates Rust state)
5. `updateCursorPos()` → `statusBar.setCursorPos()` → `update()` → `setStatusText(...)` → **no render** (just updates Rust state)
6. `focusEditor()` → **single render** with final correct state: `"NORMAL  file.txt  2:1"`

One render per keypress, with the correct status bar content. No flicker.

### Preserving renders for non-keypress paths

Several NAPI functions still call `render_frame_internal()` and must continue to do so because they are called outside the key processing loop:
- `init_tui()` — initial render
- `load_file()` — file load render
- `move_cursor()` — direct cursor movement (not used in vim mode)
- `replace_range()` — text edit render
- `replace_selections()` — selection edit render
- `indent_line()` — indentation render
- `scroll_to()`, `scroll_to_line()` — scroll render
- `set_visual_mode()`, `set_vim_mode()`, `set_replace_mode()` — mode change render
- `set_highlights()` — search highlight render
- `undo()`, `redo()` — undo/redo render
- `switch_to_buffer()`, `next_buffer()`, `prev_buffer()` — buffer switch render
- `focusEditor()` — explicit render (used by resize handler and now key processing)

The resize handler in `index.ts` already calls `focusEditor()` after `statusBar.refresh()`, so it continues to work correctly.

## Tasks

### Task 1 - Remove redundant renders from Rust NAPI functions

Remove `render_frame_internal()` calls from `set_cursor_pos`, `set_selection`, `set_selections`, and `set_status_text` in `lib/src/tui/api.rs`. Each function currently locks state, mutates it, drops the lock, then calls `render_frame_internal()`. Change each to only lock and mutate — remove the `render_frame_internal()` call after the lock scope.

For `set_status_text`, the function becomes a pure state setter: lock → set `state.status_text = text` → unlock → return `Ok(())`. No render.

For `set_cursor_pos`, `set_selection`, and `set_selections`, same pattern: lock → mutate → unlock → return. No render.

- `set_status_text("NORMAL  file.txt  2:1")` called
  - → `state.status_text` updated in Rust
  - → no render triggered (render happens when `focusEditor()` is called)
- `set_cursor_pos` called with line=5, ch=3
  - → cursor moves to (5,3) in Rust state
  - → no render triggered
- `set_selection` called with anchor=(0,0), head=(5,3)
  - → selection updated in Rust state
  - → no render triggered
- `set_selections` called with multiple selections
  - → selections updated in Rust state
  - → no render triggered
- Existing E2E tests pass (cursor movement, visual mode, status bar)
  - → all assertions still pass because `focusEditor()` drives the final render

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

### Task 3 - Add `focusEditor()` render at end of key processing

Add `focusEditor()` call at the end of `processKeyEvent()` in `app/src/index.ts`, after `vimMode.handleKey(encodedKey)`. This is now the sole render trigger during key processing, since `setStatusText()` no longer renders.

Also add `focusEditor()` after `statusBar.setFilePath(firstFilePath)` in the `main()` function (line ~96). Since `setStatusText()` no longer renders, the initial status bar won't be visible until `focusEditor()` is called. The `initTui()` and `loadFile()` calls still render (they have their own `render_frame_internal()` calls), but the status bar text set by `TerminalStatusBar` constructor and `setFilePath` won't be rendered without this explicit `focusEditor()`.

- Normal keypress (`j`) in normal mode
  - → `focusEditor()` called after `handleKey()` completes
  - → single render shows final state (cursor moved, status bar updated with correct position)
- Keypress during prompt mode (`/` search)
  - → `focusEditor()` called after `handleKey()` returns (prompt handled key internally)
  - → render shows prompt text (no stale state)
- Resize event
  - → `focusEditor()` already called in resize handler
  - → no double-render issue (resize handler uses `continue` to skip normal key processing)
- Error during key processing
  - → `focusEditor()` still called (it's after `processKeyEvent` in the try block)
  - → render shows current state even if key processing partially failed
- App startup
  - → `focusEditor()` called after `statusBar.setFilePath(firstFilePath)`
  - → initial status bar rendered with correct filename and cursor position

### Task 4 - Add `focusEditor()` for async status bar updates

Since `setStatusText()` no longer renders, any status bar update that happens outside the key processing loop must be followed by `focusEditor()` to produce a visible render. Add `focusEditor()` calls in `TerminalStatusBar` for:

1. **`showNotification(message)`** — after `setStatusText(message)`, add `focusEditor()`
2. **`showNotification` timeout callback** — after `this.update()`, add `focusEditor()`
3. **`startDisplay(message)`** — after `setStatusText(message)`, add `focusEditor()`
4. **`startDisplay` closer** — after `this.update()`, add `focusEditor()`
5. **`startPrompt(prefix, ...)`** — after `setStatusText(prefix)`, add `focusEditor()`
6. **`startPrompt` closer** — after `this.update()`, add `focusEditor()`

Import `focusEditor` from `@revim/lib` in `terminal-status-bar.ts`.

Methods called during key processing (`setMode`, `setKeyBuffer`, `setCursorPos`, `setFilePath`, `handlePromptKey`, `clear`) do NOT need `focusEditor()` because `focusEditor()` is called at the end of `processKeyEvent()`.

- Notification shown via `showNotification("E21: file is read-only")`
  - → `setStatusText(...)` updates Rust state
  - → `focusEditor()` renders the notification
  - → notification visible immediately
- Notification auto-clears after 3 seconds
  - → timeout fires, `update()` composes mode+filename+line:col
  - → `setStatusText(...)` updates Rust state
  - → `focusEditor()` renders the restored status bar
  - → notification cleared visually
- Display message shown via `startDisplay("3 substitutions")`
  - → `setStatusText(...)` updates Rust state
  - → `focusEditor()` renders the display message
  - → display message visible immediately
- Display message closed via closer
  - → `update()` composes mode+filename+line:col
  - → `setStatusText(...)` updates Rust state
  - → `focusEditor()` renders the restored status bar
  - → display message cleared visually
- Search prompt opened via `startPrompt("/")`
  - → `setStatusText("/")` updates Rust state
  - → `focusEditor()` renders the prompt
  - → prompt visible immediately
- Search prompt closed via closer
  - → `update()` composes mode+filename+line:col
  - → `setStatusText(...)` updates Rust state
  - → `focusEditor()` renders the restored status bar
  - → prompt cleared visually

### Task 5 - Update unit tests for `TerminalStatusBar`

Update the unit tests in `app/tests/unit/terminal-status-bar.test.ts` and `app/tests/unit/terminal-status-bar-features.test.ts` to account for:
1. The `cursorLine`/`cursorCol` fields being removed and `update()` now calling `getCursorPos()` directly
2. `focusEditor` being called in `showNotification`, `startDisplay`, `startPrompt`, and their closers/timeouts

- `setCursorPos()` no longer stores cursor position in fields
  - → `setCursorPos()` just calls `update()`, which reads from `getCursorPos()`
- Mock `getCursorPos` returns expected values in all tests
  - → status text assertions still pass
- `setStatusText` mock still captures all calls
  - → call order and content assertions still pass

## Technical Context

- `getCursorPos()` is already imported in `terminal-status-bar.ts` (used in the constructor)
- `focusEditor()` is already imported in `index.ts` (used in resize handler)
- The `render_frame_internal()` function in `lib/src/tui/render.rs` reads `status_text` from `TuiState` — removing renders from `setStatusText` doesn't affect what gets rendered, only when
- Ratatui's `terminal.draw()` uses double buffering with diffing — only changed cells are written to the terminal, so reducing renders also reduces terminal I/O
- The resize handler in `index.ts` already calls `focusEditor()` after `statusBar.refresh()`, so it continues to work correctly without `setStatusText` triggering renders

## Notes

- The `set_cursor_pos` function currently returns `Result<CursorPosition>` — the return value is used by `adapter.setCursor()` to sync the TypeScript-side selection state. Removing `render_frame_internal()` does not affect the return value.
- The `set_selection` and `set_selections` functions currently return `Result<()>` — removing `render_frame_internal()` is a clean change.
- `set_status_text` currently returns `Result<()>` — removing `render_frame_internal()` is a clean change.
- After this fix, the render sequence for a `j` keypress is a single render via `focusEditor()`, with the correct status bar content showing the final cursor position and no key buffer.
- The key buffer ("j") will no longer be visible for a split frame. This is acceptable because the key buffer appears and disappears within a single event loop tick — the user never sees it anyway since there's no render between `setKeyBuffer("j")` and `setKeyBuffer("")`. If future UX requirements need the key buffer to be visible, a deliberate render can be added via `focusEditor()` after `setKeyBuffer("j")`.
- `focusEditor` must be called after any `setStatusText` or `update()` call that happens outside the key processing loop (notifications, display messages, prompts). Task 4 enumerates all such call sites in `TerminalStatusBar`.
- The `save-file` event handler in `index.ts` calls `setStatusText` directly, but this happens during key processing (triggered by `:w` command), so `focusEditor()` at the end of `processKeyEvent()` covers it.