# Multi-Buffer Support

## Context

ReVim currently supports editing a single file at a time. Users pass one file path on the command line (or none, which loads demo content), and the entire editor state — buffer content, cursor, scroll position, undo history — lives in a single flat `TuiState` struct in Rust. There is no way to switch between files without restarting the editor.

This story adds multi-buffer support so users can open multiple files from the CLI (`revim file1.ts file2.ts file3.md`) and switch between them using standard Vim keybindings (`gt`/`gT`) and ex commands (`:bnext`/`:bprev`). Buffer state (content, cursor, scroll, undo/redo) is fully managed in Rust; TypeScript only resets Vim mode state on switch and updates the status bar filename.

## Out of Scope

- Tab/bar visualization in the UI
- `:ls` / `:buffers` command
- `:bd` / `:bdelete` command
- `:e <file>` to open new files after startup (the `:e` stub remains but is not wired for multi-buffer)
- Split windows / panes
- File change detection or read-only guards
- Dirty-buffer warnings on switch (unsaved changes are preserved in memory)
- Per-buffer Vim marks (marks are reset on switch for MVP)

## Implementation Approach

### Rust: `BufferState` struct and buffer list

All per-buffer state moves into a new `BufferState` struct. `TuiState` holds a `Vec<BufferState>` and an `active: usize` index. Existing flat fields (`demo_text`, `cursor_row`, etc.) become fields of `BufferState`, accessed via `self.buffers[self.active]` through helper methods `active()` / `active_mut()`.

```rust
struct BufferSnapshot {
    lines: Vec<String>,
    cursor_row: u16,
    cursor_col: u16,
}

struct BufferState {
    lines: Vec<String>,        // was demo_text
    cursor_row: u16,
    cursor_col: u16,
    anchor_row: u16,
    anchor_col: u16,
    scroll_top: u16,
    current_path: Option<String>,
    undo_stack: Vec<BufferSnapshot>,
    redo_stack: Vec<BufferSnapshot>,
}

pub struct TuiState {
    buffers: Vec<BufferState>,
    active: usize,
    // Global (not per-buffer):
    visual_mode: VisualMode,
    selections: Vec<Selection>,
    highlights: Vec<HighlightRange>,
    status_text: String,
}
```

`visual_mode`, `selections`, and `highlights` remain global in `TuiState` because they are reset on every buffer switch (exit visual mode, clear search highlights). `status_text` is also global.

### Rust: Undo/redo migration

Undo/redo moves from TypeScript (`adapter.ts` `undoStack`/`redoStack`) into `BufferState`. This makes undo history per-buffer automatically. New NAPI functions `undo()` and `redo()` replace the TypeScript-managed stacks. `push_undo_stop()` becomes functional (currently a no-op).

### Rust: Buffer switching

`switch_to(index)` on `TuiState` saves visual state resets:
- `visual_mode = None`
- `selections` synced to cursor position of target buffer
- `highlights` cleared

`next_buffer()` and `prev_buffer()` wrap around the buffer list. With only one buffer they are no-ops (return the current buffer info).

### Rust: NAPI surface

New functions:

| Function | Returns | Description |
|---|---|---|
| `open_buffer(path)` | `BufferInfo { index, path }` | Read file, create `BufferState`, push to `buffers`, do NOT switch. Returns new buffer index. |
| `switch_to_buffer(index)` | `BufferInfo` | Switch to buffer at index. |
| `next_buffer()` | `BufferInfo` | Switch to `(active + 1) % buffers.len()`. |
| `prev_buffer()` | `BufferInfo` | Switch to `(active + buffers.len() - 1) % buffers.len()`. |
| `get_buffer_count()` | `u32` | Number of buffers. |
| `get_current_buffer_index()` | `u32` | Active buffer index. |
| `undo()` | `CursorPosition` | Pop undo stack, push current to redo, restore. |
| `redo()` | `CursorPosition` | Pop redo stack, push current to undo, restore. |

Updated functions: `push_undo_stop()` becomes functional (saves snapshot to active buffer's undo stack, clears redo). `load_file(path)` sets content and path on the active buffer (backward compatible). `get_current_path()` returns `active().current_path`. `set_current_path(path)` sets `active_mut().current_path`. `save_file(path)` saves `active().lines`.

All existing NAPI functions that access `state.demo_text`, `state.cursor_row`, etc. are refactored to use `state.active()` / `state.active_mut()`.

### Rust: `render_frame_internal` changes

`render_frame_internal` reads from `state.active()` instead of flat fields. The snapshot taken inside the mutex lock uses `state.active().lines`, `state.active().cursor_row`, etc.

### TypeScript: CLI parsing

`parseFilePath` becomes `parseFilePaths` returning `string[]`. `main()` loads the first file with `loadFile()`, then calls `openBuffer()` for each additional file. If no files are given, the default demo content is loaded as before.

### TypeScript: Undo/redo migration

`EditorAdapter` removes `undoStack` and `redoStack` fields. `pushUndoStop()`, `undo()`, and `redo()` call the new NAPI functions. After `undo()`/`redo()`, the adapter syncs its selection and dispatches `cursorActivity`.

### TypeScript: Buffer switch handling

When a buffer switch occurs (via `gt`/`gT` or `:bnext`/`:bprev`), the handler must:

1. Call the NAPI function (`nextBuffer()` / `prevBuffer()`).
2. If only one buffer exists, no-op.
3. Reset Vim state: exit insert mode (`adapter.insertMode = false`, `setVimMode(true)`), exit visual mode (`exitVisualMode(adapter)`), clear input state (`clearInputState(adapter)`).
4. Update status bar filename: `statusBar.setFilePath(result.path)`.
5. Dispatch `cursorActivity`.

This logic lives in a new `switchBuffer` function called from both the action handler and the ex command handler. The adapter dispatches a `"buffer-switch"` event with the new path; `VimMode` listens and coordinates the Vim state reset and status bar update.

Important: the Vim state's `insertMode` flag (`vim.insertMode`) must also be set to `false` during a buffer switch. The adapter's `insertMode` and the Vim state's `insertMode` are separate — both must be reset. The simplest approach is to call `adapter.enterVimMode()` (which sets `adapter.insertMode = false` and calls `setVimMode(true)`) and then set `vim.insertMode = false` directly on the Vim state object.

### TypeScript: Key mappings and ex commands

`default-key-map.ts` additions:
```ts
{ keys: "gt", type: "action", action: "nextBuffer", context: "normal" },
{ keys: "gT", type: "action", action: "prevBuffer", context: "normal" },
```

`actions.ts` additions:
```ts
nextBuffer: (adapter, _actionArgs, _vim) => { /* call NAPI, dispatch event */ },
prevBuffer: (adapter, _actionArgs, _vim) => { /* call NAPI, dispatch event */ },
```

`ex-commands.ts` additions:
```ts
bnext: (_adapter, _params) => { /* call NAPI, dispatch event */ },
bprev: (_adapter, _params) => { /* call NAPI, dispatch event */ },
```

Both the action handlers and ex commands dispatch `"buffer-switch"` on the adapter. `VimMode` listens for this event and performs the Vim state reset and status bar update.

### Edge cases

- **Single buffer**: `gt`/`gT`/`:bnext`/`:bprev` are no-ops (stay on same buffer).
- **Wrap-around**: `gt` on last buffer wraps to first; `gT` on first wraps to last.
- **File not found**: `open_buffer` shows error message in buffer content (same as `load_file`).
- **No CLI files**: Default demo content loaded as before; single-buffer mode.
- **Unsaved changes**: Preserved in memory when switching; no warning prompt (out of scope).

## Tasks

### Task 1 — Refactor `TuiState` to hold a buffer list with per-buffer state

- `BufferState` struct exists in `state.rs` with fields: `lines`, `cursor_row`, `cursor_col`, `anchor_row`, `anchor_col`, `scroll_top`, `current_path`, `undo_stack`, `redo_stack`
- `BufferSnapshot` struct exists in `state.rs` with fields: `lines`, `cursor_row`, `cursor_col`
- `TuiState` has `buffers: Vec<BufferState>` and `active: usize` instead of flat per-buffer fields
- `TuiState::active()` returns `&BufferState` for `self.buffers[self.active]`
- `TuiState::active_mut()` returns `&mut BufferState`
- `TuiState::new()` creates one empty `BufferState` (single empty line, cursor at 0,0)
- All existing methods on `TuiState` (`set_lines`, `max_rows`, `current_line_len`, `get_line`, `get_range`, `replace_range`, `clip_pos`, `index_from_pos`, `pos_from_index`, `sync_primary_selection`, `adjust_scroll`) use `self.active()` / `self.active_mut()` instead of flat fields
- `render_frame_internal` reads from `state.active()` instead of flat fields
- All NAPI functions in `api.rs` that access buffer state use `state.active()` / `state.active_mut()`
- `just test-rust` passes

### Task 2 — Implement undo/redo in Rust and add buffer-switching NAPI functions

- `push_undo_stop()` saves `{ lines, cursor_row, cursor_col }` to `active_mut().undo_stack` and clears `active_mut().redo_stack`
- `undo()` NAPI function: if undo stack empty, return current cursor; otherwise push current state to redo stack, pop from undo stack, restore lines/cursor, call `render_frame_internal()`, return new cursor position
- `redo()` NAPI function: if redo stack empty, return current cursor; otherwise push current state to undo stack, pop from redo stack, restore lines/cursor, call `render_frame_internal()`, return new cursor position
- `open_buffer(path)` NAPI function: read file (or error message), create `BufferState`, push to `buffers` vector, return `BufferInfo { index, path }`; does NOT switch to the new buffer
- `switch_to_buffer(index)` NAPI function: validate index, reset visual state, swap active buffer, call `render_frame_internal()`, return `BufferInfo`
- `next_buffer()` NAPI function: if only one buffer return current info; otherwise compute `(active + 1) % len`, delegate to `switch_to_buffer`
- `prev_buffer()` NAPI function: if only one buffer return current info; otherwise compute `(active + len - 1) % len`, delegate to `switch_to_buffer`
- `get_buffer_count()` NAPI function: return `buffers.len()`
- `get_current_buffer_index()` NAPI function: return `active`
- `BufferInfo` NAPI object struct with `index: u32` and `path: Option<String>`
- `load_file(path)` updated to set content on `active_mut()` instead of flat fields
- `save_file(path)` updated to save from `active().lines`
- `get_current_path()` / `set_current_path()` updated to use `active()` / `active_mut()`
- `set_lines()` on `BufferState` resets cursor/anchor/scroll to 0 and clears undo/redo stacks
- `just test-rust` passes

### Task 3 — Migrate TypeScript undo/redo to NAPI and add buffer-switch event handling

- `EditorAdapter` removes `undoStack` and `redoStack` fields
- `pushUndoStop()` calls NAPI `pushUndoStop()` instead of managing local stack
- `undo()` calls NAPI `undo()`, syncs selection, dispatches `cursorActivity`
- `redo()` calls NAPI `redo()`, syncs selection, dispatches `cursorActivity`
- New `switchBuffer` function in `index.ts` (or a new module) that:
  - Calls `nextBuffer()` / `prevBuffer()` NAPI function
  - If buffer count is 1, returns early (no-op)
  - Exits insert mode on the adapter
  - Calls `exitVisualMode(adapter)` if in visual mode
  - Calls `clearInputState(adapter)`
  - Updates status bar filename via `statusBar.setFilePath(result.path)`
  - Dispatches `cursorActivity` on the adapter
- `VimMode` listens for `"buffer-switch"` event and calls `switchBuffer`
- `just test-unit` passes
- `just lint` passes

### Task 4 — Add `gt`/`gT` key mappings and `:bnext`/`:bprev` ex commands

- `default-key-map.ts` has `{ keys: "gt", type: "action", action: "nextBuffer", context: "normal" }`
- `default-key-map.ts` has `{ keys: "gT", type: "action", action: "prevBuffer", context: "normal" }`
- `actions.ts` has `nextBuffer` action that calls NAPI `nextBuffer()` and dispatches `"buffer-switch"` event on the adapter
- `actions.ts` has `prevBuffer` action that calls NAPI `prevBuffer()` and dispatches `"buffer-switch"` event on the adapter
- `ex-commands.ts` has `bnext` command that calls NAPI `nextBuffer()` and dispatches `"buffer-switch"` event
- `ex-commands.ts` has `bprev` command that calls NAPI `prevBuffer()` and dispatches `"buffer-switch"` event
- `just lint` passes

### Task 5 — Update CLI parsing for multiple file paths

- `parseFilePath` in `index.ts` is replaced by `parseFilePaths` returning `string[]` (all non-flag, non-script args)
- `main()` calls `loadFile(filePaths[0])` for the first file (or demo content if no files)
- `main()` calls `openBuffer(filePaths[i])` for each additional file
- After all files are loaded, `main()` calls `switchToBuffer(0)` to ensure the first file is active
- `statusBar.setFilePath()` is called with the first file's path
- New `withFiles(filePaths: string[])` helper in `test-utils.ts` that accepts multiple file paths as CLI args
- `just lint` passes

### Task 6 — E2E tests

- Test: opening two files from CLI, pressing `gt`, verifies second file's content is visible
- Test: pressing `gT` returns to first file's content
- Test: `:bnext` switches to next buffer
- Test: `:bprev` switches to previous buffer
- Test: cursor position is preserved when switching away and back (move cursor down 3 lines, switch, switch back, cursor is still on line 3)
- Test: undo within a buffer works after switching (edit text, switch away, switch back, press `u`, edit is undone)
- Test: single file mode works as before (no regression)
- Test: `gt` with single buffer is a no-op (content doesn't change)
- Test: `just test-e2e` passes

## Technical Context

- No new npm or cargo dependencies required.
- `BufferState` and `BufferSnapshot` are Rust-only structs; they are not exposed via NAPI (only `BufferInfo` is).
- The `render_frame_internal` function in `render.rs` must read from `state.active()` instead of flat fields. The snapshot taken inside the mutex lock copies from `state.active()`.
- The deadlock rule from AGENTS.md applies: any NAPI function that calls `render_frame_internal()` must drop `TuiContext` and `state` mutex locks before calling `render_frame_internal()`. All new NAPI functions (`open_buffer`, `switch_to_buffer`, `next_buffer`, `prev_buffer`, `undo`, `redo`) must follow this pattern.
- `@microsoft/tui-test` `getByText()` only accepts `string` and `RegExp` — never pass a function. Regex patterns must include the `g` flag or `matchAll` throws a TypeError.
- E2E tests should use Vim motions (`G`, `gg`, `0`, `$`) rather than repeated key presses for reliability.

## Notes

- `open_buffer` does NOT switch to the new buffer. It adds the buffer to the list and returns its index. The caller decides whether to switch (CLI startup switches back to buffer 0 after opening all files).
- Buffer indices are 0-based and stable for the lifetime of the editor session. `next_buffer`/`prev_buffer` wrap around.
- The `:e` ex command stub (`EditorAdapter.commands.open`) remains unchanged — it dispatches an `"open-file"` event that is not handled. Wiring it for multi-buffer is out of scope.
- `visual_mode`, `selections`, and `highlights` are global (not per-buffer) and are reset on every buffer switch. This means search highlights are cleared when switching buffers, which is acceptable for MVP.
- Vim marks are reset on buffer switch (the `marks` field in `VimState` is not saved per-buffer). Per-buffer marks are out of scope.