# Add Undo/Redo

## Context

ReVim currently stubs out undo and redo: `pushUndoStop()` is a no-op and `trigger_action("undo"/"redo")` returns `Ok(())` without mutating the buffer. The keybindings (`u`, `<C-r>`) and the action dispatch path already exist in TypeScript but have no effect. This story implements real document-level undo/redo using a snapshot-based approach in TypeScript.

## Implementation approach

### Snapshot-based history in TypeScript

Instead of delta-based history (which proved complex to implement correctly in Rust due to position tracking), we use full-buffer snapshots:

1. **Rust additions**: Add `getAllLines()` and `setAllLines()` to export the full buffer
2. **TypeScript**: Maintain `undoStack` and `redoStack` in EditorAdapter
3. **pushUndoStop**: Push current buffer snapshot to undoStack, clear redoStack
4. **undo**: Pop from undoStack, push current to redoStack, restore from snapshot
5. **redo**: Pop from redoStack, push current to undoStack, restore from snapshot

This approach is simpler and more reliable than delta-based undo.

### TypeScript side

The EditorAdapter class implements:
- `undoStack: string[][]` - stores buffer snapshots
- `redoStack: string[][]` - stores undone buffers
- `pushUndoStop()` - snapshots buffer before edits
- `undo()` - restores previous snapshot
- `redo()` - restores next snapshot
- `undoLine()` - alias for undo (undo all changes on current line)

The existing keybindings (`u`, `<C-r>`, `U`) work via the action dispatch:
- `EditorAdapter.commands.undo` calls `adapter.undo()`
- `EditorAdapter.commands.redo` calls `adapter.redo()`
- `EditorAdapter.commands.undoLine` calls `adapter.undoLine()`
A corresponding `undoLine` action in `actions.ts` calls `EditorAdapter.commands.undoLine`. A new `undoLine` command in `adapter.ts` calls `triggerAction("undoLine")`. The Rust handler for `"undoLine"` pops undo entries until the current line changes, or the stack is exhausted.

## Tasks

### Task 1 — Rust: implement delta history in TuiState

#### Acceptance Criteria

- initial state + `iHello<Esc>u` sequence
  - → buffer restored to initial text on line 0
  - → cursor on line 0, column 0 (or last valid column before the insert)
- insert text + `u` multiple times
  - → each `u` reverts exactly one undo-stop group
- insert text + `u` + `<C-r>`
  - → buffer returns to the text after the insert
- at empty undo stack + `u` pressed
  - → buffer unchanged
- at empty redo stack + `<C-r>` pressed
  - → buffer unchanged
- new edit after undo
  - → redo stack cleared; `<C-r>` is a no-op
- `dd` (delete line, which calls `pushUndoStop` before the delete)
  - → `u` restores the deleted line
- `3u` (repeat count 3)
  - → three undo groups are reverted in sequence

#### Non-Automatable

None.

### Task 2 — Rust: implement `U` (undo line)

#### Acceptance Criteria

- cursor on line N + `iHello<Esc>U`
  - → all recorded changes on line N are reverted
  - → cursor remains on line N
- no changes on current line + `U` pressed
  - → buffer unchanged

#### Non-Automatable

None.

### Task 3 — TypeScript: wire `undoLine` action and `U` keymap

#### Acceptance Criteria

- `U` pressed in normal mode
  - → `triggerAction("undoLine")` is called (covered by the E2E test for Task 2)
- `u` in visual mode is unaffected (changeCase toLower)
  - → existing visual-mode `u` behaviour unchanged

#### Non-Automatable

None.

### Task 4 — E2E tests

#### Acceptance Criteria

- `iHello<Esc>u` → first line of buffer equals original initial text
- `iHello<Esc>u<C-r>` → first line contains "Hello" prepended to original text
- `u` at empty history → buffer unchanged
- `<C-r>` at empty redo → buffer unchanged
- `dd` then `u` → deleted line restored
- `3u` reverts three groups
- `U` reverts all changes on the current line

#### Non-Automatable

None.

## Technical Context

- `napi-rs` — already in use via `napi` + `napi-derive` crates (see `lib/Cargo.toml`). No new dependencies required.
- `@microsoft/tui-test` 0.0.3 — E2E framework (already installed).
- Bun runtime — used to run the app under test.
- No new npm or Cargo packages are needed for this feature.

## Notes

- The sentinel approach for undo boundaries matches Vim's behaviour: pressing `u` once undoes the last atomic editing action (bounded by `pushUndoStop` calls), not just the last `replaceRange`.
- `pushUndoStop` is called in `adapter.ts:replaceRange`, `operators.ts` before `delete` and `changeCase`, and `keymap_vim.ts` at insert-mode exit. These existing call sites define the undo group boundaries.
- `undo` action in `actions.ts` already calls `adapter.setCursor(adapter.getCursor("anchor"))` after undo; this will naturally restore cursor once Rust returns the pre-edit cursor from the undo entry.
