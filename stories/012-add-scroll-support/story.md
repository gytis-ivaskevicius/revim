# Add Scroll Support

## Context

The demo buffer currently holds 7 lines — far fewer than the 27-row inner viewport (30-row terminal minus 1 status bar row minus 2 border rows). No scrolling ever occurs, the scroll-related API stubs (`get_scroll_info`, `get_visible_lines`, `scroll_to`, `scroll_to_line`) return hardcoded nonsense, and the vim layer's page-motion and zz/zt/zb commands silently do nothing useful.

This story:
1. Expands the default buffer to ~50 lines so scrolling is required.
2. Adds `scroll_top: u16` to `TuiState` and wires it through rendering — only the viewport window is drawn.
3. Implements auto-scroll (cursor-follows-viewport) and explicit viewport positioning (`scroll_to_line` for zz/zt/zb).
4. Fixes the four API stubs to return live data.
5. Adds E2E scroll tests and updates affected snapshots.

## Out of Scope

- Horizontal scroll
- Line-number gutter
- Scroll indicators / scrollbar widget
- Search-result scroll-into-view (covered in a future story)

## Implementation approach

### Viewport geometry

```
Terminal rows = 30   (configured in test-utils.ts)
Status bar   = 1     (Constraint::Length(1))
Block border = 2     (top + bottom)
────────────────────
Inner height = 27    (viewport_height)
```

`viewport_height` is derived at render time from `context.terminal.size().height.saturating_sub(3).max(1)`.

### Rust data model

**`TuiState`** gains `scroll_top: u16` (initialized to 0).

**`TuiContext`** gains `viewport_height: std::sync::atomic::AtomicU16` (initialized to `27`). This field is written once per `render_frame_internal` call (before the draw) and read by the API stubs.

### `adjust_scroll` invariant

```
precondition: cursor_row is valid (0..max_rows)
result: scroll_top is set so cursor_row is visible

if cursor_row < scroll_top:
    scroll_top = cursor_row
elif cursor_row >= scroll_top + viewport_height:
    scroll_top = cursor_row - viewport_height + 1
scroll_top = scroll_top.min(max_rows.saturating_sub(viewport_height))
```

`adjust_scroll` is **only** called from inside `render_frame_internal` — not from `scroll_to`/`scroll_to_line` callers. This keeps the invariant centralised and prevents double-correction.

### Rendering change

`render_frame_internal` is restructured into three logical phases:

1. **Size phase** (inside first `TuiState` Mutex lock):
   - Call `context.terminal.size()` → derive `viewport_height`.
   - Store into `context.viewport_height` (AtomicU16 store, `Relaxed`).
   - Call `state.adjust_scroll(viewport_height)`.
   - Read all state fields including `state.scroll_top`.

2. **Line-building phase** (outside locks):
   - Slice `demo_text[scroll_top..(scroll_top + viewport_height).min(len)]`.
   - Build highlighted `Vec<Line>` from the slice (row indices offset by `scroll_top` when comparing against highlight/selection ranges).

3. **Draw phase** (inside outer `TUI_CONTEXT` Mutex lock):
   - Render the sliced paragraph.
   - Place terminal cursor at `(inner_area.x + cursor_col, inner_area.y + (cursor_row - scroll_top))`.

### `scroll_to` / `scroll_to_line` semantics

These are called by the TypeScript adapter for `zz`/`zt`/`zb` (via `moveCurrentLineTo`) and `scrollIntoView`. They set `scroll_top` **without** adjusting the cursor. `adjust_scroll` inside `render_frame_internal` will subsequently guarantee the cursor stays in view, so these are safe.

| API | Behaviour |
|-----|-----------|
| `scroll_to(y)` | `scroll_top = y` (clamped to valid range) |
| `scroll_to_line(line, "top")` | `scroll_top = line` |
| `scroll_to_line(line, "center")` | `scroll_top = line.saturating_sub(viewport_height / 2)` |
| `scroll_to_line(line, "bottom")` | `scroll_top = line.saturating_sub(viewport_height - 1)` |

All clamped to `[0, max_rows.saturating_sub(viewport_height)]`.

### `get_scroll_info` / `get_visible_lines`

```rust
get_scroll_info() → { top: scroll_top, height: total_lines, client_height: viewport_height }
get_visible_lines() → { top: scroll_top, bottom: (scroll_top + viewport_height).saturating_sub(1).min(total_lines.saturating_sub(1)) }
```

`viewport_height` is loaded from `context.viewport_height` (AtomicU16, `Relaxed`).

## Tasks

### Task 1 — Expand demo text

#### Acceptance Criteria

- App starts with ≥ 40 lines of text in the default buffer.
- Each line is unique and non-empty (except intentional blank separator lines).
- `cursor-movement.test.ts`: `demoTextLines` constant updated from `7` to the actual new line count.
- All existing E2E tests continue to pass after snapshot refresh.

#### Non-Automatable

None.

---

### Task 2 — Viewport state in Rust (state.rs + mod.rs)

#### Acceptance Criteria

- `TuiState` has field `scroll_top: u16`, initialised to `0`.
- `TuiState::adjust_scroll(viewport_height: u16)` satisfies the invariant in the Implementation approach section:
  - cursor above viewport → `scroll_top = cursor_row`
  - cursor below viewport → `scroll_top = cursor_row - viewport_height + 1`
  - `scroll_top` is clamped to `max_rows.saturating_sub(viewport_height)`
- `TuiContext` has field `viewport_height: AtomicU16` initialised to `27`.
- Rust unit tests for `adjust_scroll`:
  - cursor at row 0, vh=27 → scroll_top stays 0
  - cursor at row 26, vh=27 → scroll_top stays 0
  - cursor at row 27, vh=27 → scroll_top becomes 1
  - cursor at row 50 (last), vh=27, max_rows=50 → scroll_top clamps to max_rows-vh

#### Non-Automatable

None.

---

### Task 3 — Viewport-sliced rendering (render.rs)

#### Acceptance Criteria

- `render_frame_internal` computes `viewport_height` from `context.terminal.size()` before building lines.
- `viewport_height` is stored in `context.viewport_height`.
- `state.adjust_scroll(viewport_height)` is called before reading `scroll_top`.
- Only lines `[scroll_top, scroll_top + viewport_height)` are passed to ratatui `Paragraph`.
- Terminal cursor is placed at `(inner_area.x + cursor_col, inner_area.y + cursor_row_in_viewport)` where `cursor_row_in_viewport = cursor_row - scroll_top`, clamped to `inner_area.height - 1`.
- With 50-line buffer and cursor at row 0: only first 27 lines are visible; line 28+ are NOT rendered (verified by snapshot / getByText).
- After cursor moves to row 27: line 0 is no longer rendered; line 27 is visible.

#### Non-Automatable

None.

---

### Task 4 — Fix scroll API stubs (api.rs)

#### Acceptance Criteria

- `get_scroll_info()`:
  - Returns `top = scroll_top` (not always 0).
  - Returns `height = total line count`.
  - Returns `client_height = viewport_height` (from AtomicU16, not hardcoded 20).
- `get_visible_lines()`:
  - Returns `top = scroll_top`.
  - Returns `bottom = (scroll_top + viewport_height - 1).min(total_lines - 1)`.
- `scroll_to(y)`:
  - Sets `scroll_top = y` (clamped to `[0, max_rows.saturating_sub(viewport_height)]`).
  - Does **not** move `cursor_row`.
  - Calls `render_frame_internal`.
- `scroll_to_line(line, "top"|"center"|"bottom")`:
  - Sets `scroll_top` per the table in the Implementation approach section.
  - Does **not** move `cursor_row`.
  - Calls `render_frame_internal`.

#### Non-Automatable

None.

---

### Task 5 — E2E scroll tests + snapshot updates

#### Acceptance Criteria

**New file `app/tests/e2e/scroll.test.ts`:**

- `initial state: first viewport lines visible, content beyond viewport not visible`
  - On startup: `getByText("Welcome to ReVim!")` is visible.
  - A line that exists only beyond row 27 (e.g., the last line of the buffer) is **not** visible.

- `moving cursor down past viewport scrolls content up`
  - Press ArrowDown 27+ times; wait for renders.
  - `getByText("Welcome to ReVim!")` is **not** visible (scrolled off top).
  - A line that was previously off-screen (below row 26) **is** now visible.

- `moving cursor back up from scrolled position scrolls content back down`
  - After scrolling down, press ArrowDown enough to scroll, then press ArrowUp until back to row 0.
  - `getByText("Welcome to ReVim!")` is visible again.

- `G key jumps to last line and it is visible`
  - Press Escape (ensure normal mode), then press `G`.
  - The last line of the buffer is visible.
  - `getByText("Welcome to ReVim!")` is **not** visible.

- `gg key after G returns to first line`
  - After pressing `G`, press `g` twice (`gg`).
  - `getByText("Welcome to ReVim!")` is visible.
  - The last line is **not** visible.

**Snapshot updates:**
- `initial-render.test.ts.snap`: regenerated to show new demo text content.
- `cursor-visibility.test.ts.snap`: regenerated (demo text lines changed).
- `visual-mode.test.ts.snap`: regenerated (demo text lines changed).
- Run `bunx @microsoft/tui-test --update` to regenerate all.

#### Non-Automatable

None.

## Technical Context

- **ratatui 0.30.0** — `Terminal::size()` returns `io::Result<ratatui::layout::Size>` where `Size { width: u16, height: u16 }`. No breaking changes relevant here.
- **crossterm 0.29.0** — no changes relevant here.
- **@microsoft/tui-test** — `terminal.getByText(str).toBeVisible()` assertion used for scroll visibility checks. Terminal configured at 30 rows × 80 columns in `test-utils.ts`.
- **AtomicU16** — available in `std::sync::atomic`. Use `Ordering::Relaxed` for viewport_height reads/writes (no synchronisation guarantee needed; render always runs before the API stubs return meaningful data in practice).
- Viewport geometry: `terminal_height(30) - status_bar(1) - block_borders(2) = 27` inner rows.

## Notes

- Do NOT change the `wrapping` behaviour of `move_cursor` (ArrowUp at row 0 stays, ArrowDown at last row stays). Only `scroll_top` shifts; the logical cursor position follows vim semantics.
- The `adjust_scroll` method must not be called from `scroll_to` / `scroll_to_line` directly — only from `render_frame_internal` — to prevent double-correction and to keep explicit viewport-positioning working.
- After this story, the known limitation "No real viewport semantics" in `docs/product.md` can be removed.
