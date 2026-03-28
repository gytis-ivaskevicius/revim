# Ctrl+C Exit and Visual Mode Rendering

## Context

Two regressions block forward progress after story 005:

1. **Ctrl+C does not exit the application.** The E2E test `exit.test.ts` times out at 30 s on first attempt. Root cause: `ThreadsafeFunction` in NAPI-RS keeps a strong reference on the Node.js event loop, preventing exit even after `process.exit(0)` is reached — or the `\x03` byte from the PTY is being swallowed before the keyboard callback fires. The fix is to call `process.exit(0)` synchronously inside the keyboard callback when Ctrl+C is detected, bypassing the `await` chain, and to unref the threadsafe function so the event loop can drain cleanly when no more events are expected.

2. **Visual mode has no visible selection.** When the user presses `v`, `V`, or `Ctrl-V`, the vim state machine enters visual mode and calls `setSelection` / `setSelections` on the adapter, which writes `anchor_row/col` and `cursor_row/col` into `TuiState`. However `render_frame_internal` never reads the selection range — it only highlights the single cursor cell. The user sees no feedback that a selection is active.

Both issues are verified by writing E2E tests first, then fixing the code to make them pass.

## Out of Scope

- Vim `:` command-line or status bar mode indicator — those are follow-up stories.
- Scroll offset / viewport — selection rendering is limited to the lines currently in the demo buffer (no scrolling needed for the test cases).

## Implementation approach

### Task 1 — Ctrl+C exits cleanly

**Root cause confirmation:** The `start_keyboard_listener` Rust thread calls the NAPI `ThreadsafeFunction` callback. By default, NAPI-RS 3.x `ThreadsafeFunction` is ref-counted and keeps the event loop alive. When `resolve()` is called inside the callback and the promise settles, `process.exit(0)` is reached, but in Bun's runtime the exit may be deferred while native threads are outstanding.

**Fix — two-part:**

1. Inside `start_keyboard_listener` in `lib/src/tui.rs`, change the `ThreadsafeFunction` call mode from `NonBlocking` to `Blocking` and store the handle so it can be aborted, OR — simpler — call `callback.abort()` after setting `TUI_RUNNING = false` to drop the ref. The preferred fix is to unref the callback before spawning the thread so the event loop can exit regardless:

   ```rust
   // In start_keyboard_listener, before spawning:
   callback.unref(&env)?;    // event loop will not be kept alive by this TSF
   ```

   This requires changing the function signature to `#[napi]` with `env: Env` parameter.

2. In `app/src/index.ts`, move the Ctrl+C exit logic so `process.exit(0)` is called synchronously inside the callback, not after awaiting the promise:

   ```typescript
   startKeyboardListener((err, event) => {
     if (err) { console.error("Error:", err); return; }
     if (event.key === "c" && event.modifiers.includes("Ctrl")) {
       vimMode.adapter.dispose();
       shutdownTui();
       process.exit(0);
     }
     processKeyEvent(vimMode, event);
   });
   // main() just awaits a never-settling promise; the exit happens in the callback
   ```

   Remove the `await new Promise` wrapper — replace it with `await new Promise<never>(() => {})` (hangs until `process.exit` is called from the callback).

**Invariant:** After `shutdownTui()`, the Rust keyboard thread exits within 100 ms (poll timeout). `process.exit(0)` guarantees the process terminates even if the thread lingers.

### Task 2 — Visual mode selection highlight

**Where to change:** `render_frame_internal` in `lib/src/tui.rs`.

Currently the render only passes `cursor_col` to `build_highlighted_line` for the cursor row and ignores the selection. The fix reads `anchor_row/col` and `cursor_row/col` from state, orders them, and marks every character in the range with `Modifier::REVERSED` (same style as the cursor) so selected text is visually distinct.

**Render rules — charwise (`v`) and linewise (`V`):**

- Selection is active when `anchor_row != cursor_row || anchor_col != cursor_col`.
- Ordering: compute `(sel_start_line, sel_start_ch)` = `min(anchor, cursor)`, `(sel_end_line, sel_end_ch)` = `max(anchor, cursor)`.
- For rows strictly between start and end (multiline): entire row is highlighted.
- For the start row: columns `[sel_start_ch, line_len)` are highlighted.
- For the end row: columns `[0, sel_end_ch]` inclusive.
- Single-row selection: columns `[sel_start_ch, sel_end_ch]` inclusive.
- Linewise (`V`): highlight columns `[0, line.len()]` for every row from start to end, regardless of anchor/head column values.

**Render rules — visual block (`Ctrl-V`):**

Visual block is indicated by `vim.visualBlock === true` in the vim state. The adapter does not currently pass the visual mode subtype to Rust, so the block subtype must be tracked in `TuiState`. Add a `visual_mode: VisualMode` enum field to `TuiState`:

```rust
#[derive(Clone, PartialEq)]
enum VisualMode { None, Char, Line, Block }
```

Add a `#[napi]` function `set_visual_mode(mode: String)` (values: `"char"`, `"line"`, `"block"`, `""` for normal) called from the TypeScript adapter whenever `vim-mode-change` fires.

Call `setVisualMode` in `EditorAdapter.dispatch` when event is `"vim-mode-change"`:
- `mode === "visual"` + `subMode === "linewise"` → `setVisualMode("line")`
- `mode === "visual"` + `subMode === "blockwise"` → `setVisualMode("block")`
- `mode === "visual"` (no subMode or `subMode === ""`) → `setVisualMode("char")`
- `mode !== "visual"` → `setVisualMode("")`

Block rendering: for each row between `min(anchor_row, cursor_row)` and `max(anchor_row, cursor_row)` inclusive, highlight columns `[min(anchor_col, cursor_col), max(anchor_col, cursor_col)]` inclusive.

**Cursor cell** gets `Modifier::REVERSED` regardless of selection state.

The existing `build_highlighted_line` helper takes `(line, cursor_col, highlights: &[(start, end)])` where highlights are exclusive ranges. Extend call sites to pass the selection range as additional highlight entries (or refactor to a single unified highlight pass).

**Signature change for `render_frame_internal`:** extract `anchor_row`, `anchor_col` alongside `cursor_row`, `cursor_col` in the state read block, then compute selection highlight ranges per row before calling `build_highlighted_line`.

## Tasks

### Task 1 - Fix Ctrl+C exit

Write the E2E test first (it already exists in `exit.test.ts` and is failing), then make it pass.

**Changes:**

- `lib/src/tui.rs`: add `env: Env` param to `start_keyboard_listener`, call `callback.unref(&env)` before the thread spawn. Import `napi::Env`.
- `app/src/index.ts`: restructure so Ctrl+C calls `dispose()`, `shutdownTui()`, and `process.exit(0)` synchronously inside the callback. Replace the `await new Promise(resolve => ...)` wrapper with `await new Promise<never>(() => {})`.
- Rebuild: `just build` after Rust changes.

#### Acceptance Criteria

- app running + `Ctrl+C` sent by test
  - → process exits with code 0 within 5 s
  - → `terminal.exitResult.exitCode === 0`
- app running + no Ctrl+C
  - → process does not exit (hangs waiting)

#### Non-Automatable

- Manual smoke: `just dev`, press Ctrl+C in terminal — shell prompt returns (verifies terminal state is cleaned up, not just exit code).

### Task 2 - Render visual mode selection

Write E2E tests for charwise (`v`), linewise (`V`), and visual-block (`Ctrl-V`) selection first, then make them pass.

**Test file:** `app/tests/e2e/visual-mode.test.ts`

**Test cases to write:**

1. Press `v` → selection starts at cursor; pressing `l` extends selection one char right → at least 2 characters appear with reversed styling (snapshot with `includeColors: true`).
2. Press `v`, extend selection to end of word with `e`, press `d` → selected text is deleted, buffer updated.
3. Press `V` (linewise) → entire current line is highlighted.
4. Press `v`, `<Esc>` → selection is cleared, single cursor shown.
5. Press `Ctrl-V`, press `j` (extend block down one row) → two characters (one per row, same column) appear reversed.

**Changes:**

- `lib/src/tui.rs`: add `VisualMode` enum and `visual_mode` field to `TuiState`. Add `set_visual_mode(mode: String)` NAPI function. Modify `render_frame_internal` to compute per-row highlight ranges based on `visual_mode`, `anchor_row/col`, and `cursor_row/col`. When `visual_mode == None`, pass empty selection highlights — only the cursor cell is reversed.
- `app/src/vim/adapter.ts`: in the `"vim-mode-change"` dispatch handler inside `EditorAdapter`, call `setVisualMode(subMode)` after dispatching to listeners.
- Rebuild: `just build` after Rust changes.

#### Acceptance Criteria

- app at initial state + `v` pressed
  - → cursor character is rendered reversed (selection open at single char)
- app at initial state + `v` + `l` pressed (extend selection right by 1)
  - → two characters rendered reversed
  - → snapshot matches expected selection style
- app at initial state + `V` pressed
  - → entire first line rendered reversed
- app at initial state + `v` + `e` + `d` pressed
  - → first word deleted from buffer
  - → buffer no longer contains the deleted word at position 0
- app at initial state + `v` + `<Esc>` pressed
  - → only single cursor cell reversed (selection cleared)
- app at initial state + `Ctrl-V` + `j` pressed (extend block down one row)
  - → column 0 of row 0 and column 0 of row 1 are both reversed
  - → snapshot matches expected block selection style

#### Non-Automatable

- None — all visual selection behaviors are verified by E2E snapshot tests (`includeColors: true` captures `inverse` styling per cell).

## Technical Context

- napi-rs 3.8.3 / napi-derive 3.5.2 — `ThreadsafeFunction::unref(&env)` is available in this version; no upgrade needed.
- `@microsoft/tui-test` 0.0.3 — `terminal.getByText()`, `terminal.getCursor()`, snapshot with `includeColors: true` available.
- Bun 1.3.9 — `process.exit(0)` is synchronous and terminates the process immediately.
- crossterm 0.29.0 — `enable_raw_mode()` disables ISIG so `\x03` is delivered as a key event, not converted to SIGINT.
- ratatui 0.30.0 — `Modifier::REVERSED` is available and used for cursor rendering.

## Notes

- The `visual-mode.test.ts` snapshot assertions should use `{ includeColors: true }` to capture the reversed style, not just text content.
- When writing the visual delete test (`v` + `e` + `d`), assert on buffer content using `terminal.getViewableBuffer()` text scan, not a snapshot — snapshots are too brittle for content mutations.
- `build_highlighted_line` currently takes highlights as `&[(u16, u16)]` (exclusive ranges). Selection ranges for charwise inclusive end need `end_ch + 1` when passed to this function.
- The linewise (`V`) selection highlight should cover columns `[0, line.len()]` for every selected row.
- For visual block, `Ctrl-V` in `encodeTerminalKey` produces `"Ctrl-v"` — confirm this matches what `keymap_vim.ts` expects for entering blockwise mode before writing the block test.
- `setVisualMode` must be called from the adapter's `dispatch` handler, not from `VimMode.initListeners`, so it fires on every mode change including transitions between visual sub-modes (e.g. `v` → `V`).
