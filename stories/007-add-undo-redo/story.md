# Add Undo/Redo

## Context

ReVim currently stubs out undo and redo: `pushUndoStop()` is a no-op and `trigger_action("undo"/"redo")` returns `Ok(())` without mutating the buffer. This story implements real document-level undo/redo using a snapshot-based approach in TypeScript.

## Implementation: TypeScript Snapshot-Based Undo

### Overview

Undo/redo is implemented in TypeScript using full-buffer snapshots. Each snapshot stores both the buffer content and cursor position.

**Rust additions**:
- `getAllLines()` - returns all buffer lines as `string[]`
- `setAllLines(lines)` - replaces all buffer lines

**TypeScript implementation** (in `EditorAdapter`):
- `undoStack: { lines: string[]; cursor: Pos }[]` - stores buffer+cursor snapshots
- `redoStack: { lines: string[]; cursor: Pos }[]` - stores undone states
- `pushUndoStop()` - pushes current buffer+cursor to undoStack, clears redoStack
- `undo()` - pops from undoStack, pushes to redoStack, restores buffer+cursor
- `redo()` - pops from redoStack, pushes to undoStack, restores buffer+cursor
- `undoLine()` - alias for undo

The keybindings (`u`, `<C-r>`, `U`) are wired in TypeScript:
- `EditorAdapter.commands.undo` → `adapter.undo()`
- `EditorAdapter.commands.redo` → `adapter.redo()`
- `EditorAdapter.commands.undoLine` → `adapter.undoLine()`

### Why Snapshot-Based

Delta-based undo (storing each text change as a diff) proved complex to implement correctly in Rust due to position tracking issues with multi-character insertions. Snapshot-based undo is simpler and more reliable.

### Limitations

- No history depth limit (could exhaust memory with many edits)
- Full buffer copies on each undo stop (memory intensive for large files)
- Future: consider delta-based Rust implementation for better scalability

## Tasks

### Task 1 — TypeScript: implement snapshot-based undo/redo

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

### Task 2 — TypeScript: U (undo line)

#### Acceptance Criteria

- cursor on line N + `iHello<Esc>U`
  - → all recorded changes on line N are reverted
  - → cursor remains on line N
- no changes on current line + `U` pressed
  - → buffer unchanged

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
