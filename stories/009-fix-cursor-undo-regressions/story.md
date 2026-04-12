# Fix Cursor Visibility and Undo Regressions

## Context

Two confirmed regressions on master prevent basic editing from feeling correct when running `just dev`:

1. **Cursor invisible in normal mode.** Running `just dev` shows no block cursor in normal editing, though movement and editing still function. Visual mode correctly shows selection highlights. The root cause is a *double-inversion* in `render.rs`: `build_highlighted_line` applies `Modifier::REVERSED` to the cursor cell, and `f.set_cursor_position` tells the terminal to place the hardware cursor at the same cell. Most terminal emulators render a BLOCK-style hardware cursor by inverting the cell's colors. Because the cell is already inverted (REVERSED), the double inversion cancels out and the cursor cell appears with default colors — identical to every other unstyled cell, making it invisible. Visual mode escapes this because `cursor_col = None` is already passed in visual mode (cursor cell is not REVERSED), and selection cells only have a single inversion from the selection highlight.

   The existing E2E suite does not catch this because `terminal.getCursor()` tracks the *hardware* cursor position set by `f.set_cursor_position` (correct), and the snapshot attribute check records the cell's REVERSED attribute flag as set (technically true) — but neither assertion verifies that the cursor is *visually distinguishable* from surrounding cells in a real terminal.

2. **`r<char>` undo does not work.** The `replace` action in `app/src/vim/actions.ts` (bound to `r<character>`) modifies the buffer via `adapter.replaceRange()` or `adapter.replaceSelections()` without first calling `adapter.pushUndoStop()`. After pressing `rX`, pressing `u` has no effect because the undo stack holds no snapshot of the pre-replace state. All other buffer-mutating operations — `delete` (operator), `changeCase`, `indent` — correctly call `pushUndoStop()` before modifying. The existing undo test suite covers `i…<Esc>u`, `dd` + `u`, and multi-group undo, but omits the `r<char>` scenario.

Both bugs are caught by targeted E2E tests added in this story; no Rust unit tests are needed.

**Search is out of scope.** `/ n N` search, highlight, and prompt UX are already tracked as a known limitation and should be addressed in a dedicated follow-up story. Including search here would expand scope unreasonably.

## Out of Scope

- Search and prompt UX (`/`, `n`, `N`, search highlights, `:` prompt). Already a known limitation — handle in a separate story.
- Cursor shape configurability (block vs beam vs underline based on mode).
- Status bar cursor position indicator (line:col).

## Implementation approach

### Bug 1 — Cursor double-inversion (`lib/src/tui/render.rs`)

**Change one call site in `render_frame_internal`.** The lines:

```rust
if row == cursor_row as usize {
    build_highlighted_line(
        line,
        if selection_active {
            None
        } else {
            Some(cursor_col)
        },
        &row_highlights,
    )
```

become:

```rust
if row == cursor_row as usize {
    build_highlighted_line(
        line,
        None,   // hardware cursor (f.set_cursor_position) is the sole cursor indicator
        &row_highlights,
    )
```

Rule: pass `None` as `cursor_col` unconditionally. The hardware cursor set by `f.set_cursor_position` provides cursor visibility in all modes. REVERSED is used only for selection highlights. `build_highlighted_line` itself is unchanged.

After this fix the cell at the cursor position carries no REVERSED attribute, so the hardware cursor's single inversion renders the cell visually distinct (hardware cursor inverts default-colored cell → visible block). The initial-render snapshot must be regenerated: the cursor cell goes from `"inverse": 67108864` to `"inverse": 0`.

### Bug 2 — Missing undo stop in `replace` action (`app/src/vim/actions.ts`)

Add `adapter.pushUndoStop()` as the **first statement** of `actions.replace`, before any call to `replaceRange` or `replaceSelections`. Rule: `pushUndoStop()` must execute before any buffer mutation regardless of the mode branch (normal vs visual, newline vs character replacement). This is the same pattern already used in `operators.delete` (line 76) and `operators.changeCase` (line 126/132).

## Tasks

### Task 1 — Fix cursor double-inversion in `render.rs` and update snapshot

#### Acceptance Criteria

- `just dev` started, no key pressed
  - → `terminal.getCursor()` returns the expected initial position (inside editor content area, accounting for block border)

- `just dev` started, cursor moved right four times via ArrowRight
  - → `terminal.getCursor()` returns initial position + 4 on the x axis
  - → snapshot taken with `includeColors: true` shows `"inverse": 0` (or absent) for every cell in the cursor row — no REVERSED artifact at old or new cursor position
  - → snapshot does not differ from a freshly regenerated snapshot (idempotency)

- `just dev` started, cursor moved down one row via ArrowDown
  - → `terminal.getCursor()` returns initial position + 1 on the y axis
  - → snapshot taken with `includeColors: true` shows `"inverse": 0` for cells in both the original and new cursor row

- `just dev` in visual mode (press `v`), cursor moved right via ArrowRight
  - → selected cells still have `"inverse"` non-zero (selection REVERSED remains unaffected)
  - → `terminal.getCursor()` correctly tracks cursor position

#### Non-Automatable

Developers should manually verify with `just dev` that the cursor is a visible block when using a real terminal with default BLOCK hardware cursor style (e.g., tmux default, gnome-terminal default). The E2E tests confirm no double-inversion artifact but cannot assert perceptual visibility in every terminal emulator.

---

### Task 2 — Fix missing undo stop for `r<char>` in `actions.ts`

#### Acceptance Criteria

- cursor on the `W` of `"Welcome to ReVim!"` + `rZ` pressed
  - → first character of line 0 is `Z`
  - → `u` pressed: first character of line 0 is restored to `W`

- cursor on `W` + `rZ` + `u` + `<C-r>`
  - → after `u`: first character is `W`
  - → after `<C-r>`: first character is `Z` again

- cursor on `W` + `rZ` + `u` + new edit (press `i`, type `X`, `<Esc>`)
  - → `<C-r>` is a no-op (redo stack was cleared by the new edit)
  - → buffer contains `X` at the edited position, not `Z`

- `r<Enter>` (replace with newline)
  - → line splits at cursor; `u` restores the original single line

- at empty undo history + `r<char>` + `u`
  - → `u` reverts the replace (undo stack had one entry pushed by the replace action itself)

#### Non-Automatable

None.

---

### Task 3 — E2E tests for cursor styling after movement

Add a new test file `app/tests/e2e/cursor-visibility.test.ts`. All tests use `toMatchSnapshot({ includeColors: true })`.

#### Acceptance Criteria

- initial render snapshot
  - → matches stored snapshot showing `"inverse": 0` at cursor cell position (regression guard: catches re-introduction of REVERSED on cursor cell)

- ArrowRight × 4, snapshot taken
  - → matches stored snapshot; no cell in the cursor row has `"inverse"` non-zero
  - → `terminal.getCursor().x` equals initial x + 4

- ArrowDown × 1, snapshot taken
  - → matches stored snapshot; no cell in either original or new cursor row has `"inverse"` non-zero for cursor-only positions
  - → `terminal.getCursor().y` equals initial y + 1

- `v` to enter visual mode, ArrowRight × 3, snapshot taken
  - → selected cells still show `"inverse"` non-zero (visual selection rendering unaffected)
  - → `terminal.getCursor()` tracks cursor position

#### Non-Automatable

None.

---

### Task 4 — E2E tests for `r<char>` undo

Extend `app/tests/e2e/undo-redo.test.ts` with the scenarios from Task 2 Acceptance Criteria.

#### Acceptance Criteria

(Covered by Task 2 ACs above — same test vectors, implemented as E2E test cases.)

#### Non-Automatable

None.

## Technical Context

- ratatui `0.30.0` — `Modifier::REVERSED` and `f.set_cursor_position` are stable in 0.30.x; no API changes needed.
- `@microsoft/tui-test` `0.0.3` — `toMatchSnapshot({ includeColors: true })` records per-cell attributes including `inverse`. A non-zero `inverse` value indicates the REVERSED attribute is set on that cell. After the fix, cursor cells will show `"inverse": 0`.
- Bun runtime — already in use; no changes.
- After implementing Task 1, regenerate existing snapshots with `bunx @microsoft/tui-test --update` before committing, because the initial-render snapshot will change.

## Notes

- `build_highlighted_line` is not modified; only its call site in `render_frame_internal` changes.
- `f.set_cursor_position` remains; removing it would break `terminal.getCursor()` in all cursor movement tests.
- The `replace` action handles several branches (normal mode, visual block, newline). `pushUndoStop()` belongs at the top of the action before any branching.
- On the question of search: the user asked whether search (`/`, `n`, `N`) should be included here. **It should not.** Search involves a distinct UX surface (status-bar prompt, incremental highlighting, wrapping, `n`/`N` repeat), is already listed as a known limitation in `docs/product.md`, and would triple the scope of this story. A dedicated story is the right approach.
