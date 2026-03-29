# Add Undo/Redo

## Context

ReVim currently stubs out undo and redo: `pushUndoStop()` is a no-op and `trigger_action("undo"/"redo")` returns `Ok(())` without mutating the buffer. The keybindings (`u`, `<C-r>`) and the action dispatch path already exist in TypeScript but have no effect. This story implements real document-level undo/redo backed by an inverse-delta history stack in the Rust `TuiState`.

## Out of Scope

- Persistent undo history across process restarts
- Undo for register/mark mutations (only buffer text and cursor are tracked)
- Undo inside visual block `replaceSelections` multi-cursor paths beyond the composite delta already produced by that function

## Implementation approach

### Delta-based history in Rust

Each undo entry records enough information to invert a single `replace_range` call:

```rust
struct HistoryEntry {
    // Range that was replaced (original coordinates before the edit)
    start_line: u16,
    start_ch:   u16,
    end_line:   u16,
    end_ch:     u16,
    // Text that was removed (needed to re-insert on undo)
    removed:    String,
    // Text that was inserted (needed to re-delete on redo)
    inserted:   String,
    // Cursor position after the edit (restored on undo to the position before)
    cursor_before_line: u16,
    cursor_before_ch:   u16,
    // Cursor position after the edit (restored on redo)
    cursor_after_line: u16,
    cursor_after_ch:   u16,
}
```

`TuiState` gains two fields:
```rust
undo_stack: Vec<HistoryEntry>,
redo_stack: Vec<HistoryEntry>,
```

**Undo stop boundary**: `pushUndoStop` inserts a sentinel `HistoryEntry` with an empty `removed` and `inserted` string and zeroed coordinates. On `undo`, entries are popped and applied until a sentinel is reached (inclusive); on `redo`, entries are re-applied until the next sentinel.

**History recording rule**: every `replace_range` call on `TuiState` (the internal method, not just the NAPI export) snapshots the `removed` text via a `get_range` read *before* the splice, then records `inserted` from its `text` argument, then performs the splice. The redo stack is cleared on every new recorded edit (sentinel-only pushes do not clear it).

**Inverse application**: applying a history entry in reverse calls `replace_range` with `removed` at `(start_line, start_ch, start_line + inserted_line_count, inserted_end_ch)` — i.e., using the same `inserted` extent to locate what is now in the buffer — and replaces it with `removed`. The symmetric forward apply (redo) replaces the `removed` extent with `inserted`.

**`replaceSelections`** calls the same internal `replace_range` in a loop; each sub-operation is recorded individually in reverse order so that undo replays them in the correct order.

### TypeScript side

No TypeScript changes are required for basic `u` / `<C-r>` support. The existing `triggerEditorAction("undo"/"redo")` calls already reach the Rust NAPI function; the NAPI function just needs to do real work.

`U` (undo all changes on current line, normal mode) is added to `default-key-map.ts` as a new action:
```typescript
{ keys: "U", type: "action", action: "undoLine", context: "normal" }
```
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
