# Tabs Bar for Multi-Buffer Display

## Context

ReVim supports multi-buffer editing (story 024) with `gt`/`gT` and `:bnext`/`:bprev` to switch between buffers, but there is no visual indicator showing which buffers are open or which one is active. Users must rely on the status bar filename to know their current buffer, and have no way to see all open buffers at a glance. This story adds a tabs bar at the top of the terminal that appears when two or more buffers are open, showing all buffer filenames with the active buffer highlighted — matching standard Vim tab line behavior.

## Out of Scope

- `{n}gt` — switch to buffer by number (future story)
- `:ls` / `:buffers` command
- `:bd` / `:bdelete` command
- `:e <file>` to open new files after startup
- Mouse click on tabs to switch buffers
- Tab close button or marker for modified (unsaved) buffers
- Split windows / panes
- Reordering buffers via drag or command

## In Scope (added from user request)

- When running `just dev` (no CLI file arguments), open 2 demo buffers so the tabs bar is always visible during development. The first buffer loads `demo-content.md` as before; a second buffer loads a new `demo-scratch.md` fixture. This ensures the tabs bar feature is exercised by default.

## Implementation Approach

### Rust: Conditional tabs bar in `render_frame_internal`

The current layout in `render_frame_internal` uses a 2-area vertical layout:

```rust
let layout = Layout::vertical([Constraint::Min(0), Constraint::Length(1)]);
let [editor_area, status_area] = layout.areas(size);
```

When `state.buffers.len() > 1`, the layout changes to a 3-area vertical layout with a 1-row tabs bar at the top:

```rust
let layout = Layout::vertical([
    Constraint::Length(1),   // tabs bar
    Constraint::Min(0),      // editor area
    Constraint::Length(1),   // status bar
]);
let [tabs_area, editor_area, status_area] = layout.areas(size);
```

When `state.buffers.len() == 1`, the original 2-area layout is used (no tabs bar).

The viewport height calculation must account for the tabs bar:

- 1 buffer: `terminal_size.height - 3` (2 borders + 1 status bar) — unchanged
- 2+ buffers: `terminal_size.height - 4` (2 borders + 1 status bar + 1 tabs bar)

### Rust: Tabs bar rendering

A new function `build_tabs_line` constructs a `Line` from the buffer list:

- Each tab label: ` {n} {basename} ` where `{n}` is the 1-based buffer index and `{basename}` is the filename portion of `current_path` (or `[No Name]` if `current_path` is `None`)
- Active tab: `Span::styled(label, Style::default().add_modifier(Modifier::REVERSED))`
- Inactive tabs: `Span::raw(label)`
- Remaining width is filled with spaces to cover the full row

The tabs bar is rendered as a `Paragraph` with `Alignment::Left` in the `tabs_area`.

### Rust: Data flow in `render_frame_internal`

Phase 1 (inside locks) must now also extract:
- `buffer_paths: Vec<Option<String>>` — all buffer paths
- `active_index: usize` — active buffer index
- `show_tabs_bar: bool` — `buffers.len() > 1`

These are passed to Phase 3 for rendering.

### Rust: `open_buffer` re-render

`open_buffer` currently does not call `render_frame_internal()`. When a second buffer is opened, the tabs bar should appear. Add `render_frame_internal()` call after the locks are dropped in `open_buffer`, matching the pattern used by `load_file`, `switch_to_buffer`, `next_buffer`, and `prev_buffer`.

### Rust: `state.rs` helper

Add a method `TuiState::buffer_paths(&self) -> Vec<Option<String>>` that returns the `current_path` for each buffer. This keeps the lock scope minimal — Phase 1 reads `buffer_paths` and `active_index` alongside other state, rather than passing the entire `buffers` vector out of the lock.

### Edge cases

- **Single buffer**: No tabs bar rendered; viewport height unchanged at `terminal_height - 3`.
- **Buffer with no path** (demo content): Tab label shows `[No Name]`.
- **Very narrow terminal**: Ratatui's `Paragraph` widget truncates content that overflows the area. The tabs bar renders as much as fits; no special truncation logic needed for MVP.
- **Terminal height too small** (≤ 3 rows with tabs bar): `viewport_height` is clamped to 1 by `.max(1)`. The editor area may have 0 height; the existing guard `if editor_area.height > 0` prevents rendering or cursor placement in that case.
- **Resize**: The `Resize` event handler in `index.ts` calls `focusEditor()` which calls `render_frame_internal()`, so the tabs bar re-renders at the new width automatically.

## Tasks

### Task 1 — Add tabs bar rendering to `render_frame_internal` and viewport height logic

- `render_frame_internal` in `render.rs` reads `state.buffers.len()`, `state.active_index()`, and `state.buffer_paths()` inside the Phase 1 lock scope
- When `buffers.len() > 1`, viewport height is `terminal_size.height.saturating_sub(4).max(1)` instead of `terminal_size.height.saturating_sub(3).max(1)`
- When `buffers.len() > 1`, Phase 3 uses a 3-area layout: `[Constraint::Length(1), Constraint::Min(0), Constraint::Length(1)]` producing `[tabs_area, editor_area, status_area]`
- When `buffers.len() == 1`, Phase 3 uses the original 2-area layout (no tabs bar)
- `build_tabs_line(buffers, active_index, width)` function in `render.rs` constructs a `Line` from buffer paths:
  - Each tab: ` {n} {basename} ` where `{n}` is 1-based index, `{basename}` is `Path::new(path).file_name()` or `[No Name]`
  - Active tab span uses `Modifier::REVERSED`
  - Inactive tab spans use default style
  - Remaining width filled with spaces
- Tabs bar rendered as `Paragraph::new(tabs_line).alignment(Alignment::Left)` in `tabs_area`
- `just test-rust` passes

### Task 2 — Add `buffer_paths` helper to `TuiState` and call `render_frame_internal` from `open_buffer`

- `TuiState::buffer_paths(&self) -> Vec<Option<String>>` method returns `self.buffers.iter().map(|b| b.current_path.clone()).collect()`
- `open_buffer` in `api.rs` calls `render_frame_internal()` after the lock scope block (before returning `BufferInfo`), matching the pattern in `load_file`, `switch_to_buffer`, `next_buffer`, and `prev_buffer`
- `just test-rust` passes

### Task 3 — Open 2 demo buffers by default so tabs bar is visible during `just dev`

- Create `app/tests/fixtures/demo-scratch.md` with a few lines of scratch content (e.g., `// Scratch buffer` plus 2–3 placeholder lines)
- In `index.ts`, when `filePaths.length === 0`, after loading `demo-content.md` as the first buffer, also call `openBuffer()` with the path to `demo-scratch.md`, then call `switchToBuffer(0)` to keep the first buffer active
- This mirrors the existing multi-file CLI startup pattern (lines 82–93) but applies it to the zero-args case
- Running `just dev` with no arguments shows the tabs bar with 2 tabs: `1 demo-content.md` (active, highlighted) and `2 demo-scratch.md`
- Running `just dev path/to/file` with a single file still shows no tabs bar (single-buffer mode, unchanged)
- `just lint` passes

### Task 4 — E2E tests for tabs bar

- Test: single buffer (`withFile`) — tabs bar is not visible (no buffer index numbers like ` 1 ` appear in the top row of the rendered output)
- Test: default dev mode (no CLI args, 2 demo buffers) — tabs bar is visible showing both filenames
- Test: two buffers opened from CLI — tabs bar is visible showing both filenames (e.g., `getByText(/1.*demo-content/)` and `getByText(/2.*buffer2-content/)` both match)
- Test: pressing `gt` switches buffer and the tabs bar updates (the previously inactive filename's content becomes visible in the editor area, confirming the active tab changed)
- Test: pressing `gT` switches back and the tabs bar updates accordingly
- Test: buffer with no path (demo content loaded via default, then a second file opened) — tabs bar shows `[No Name]` for the demo buffer
- Test: `just test-e2e` passes

## Technical Context

- No new npm or cargo dependencies required.
- `ratatui` `Layout`, `Paragraph`, `Line`, `Span`, `Style`, `Modifier`, `Alignment`, `Constraint` are already imported or available in `render.rs`.
- `std::path::Path` is in the Rust standard library — no new dependency needed for filename extraction.
- The deadlock rule from AGENTS.md applies: `render_frame_internal()` acquires `TUI_CONTEXT.lock()`. Any NAPI function that holds `TUI_CONTEXT.lock()` or `state.lock()` must drop those locks before calling `render_frame_internal()`. The `open_buffer` change follows this pattern — locks are dropped in a block scope before the `render_frame_internal()` call.
- `@microsoft/tui-test` `getByText()` only accepts `string` and `RegExp` — never pass a function. Regex patterns must include the `g` flag or `matchAll` throws a TypeError.
- E2E tests should use Vim motions (`G`, `gg`, `0`, `$`) rather than repeated key presses for reliability.

## Notes

- The tabs bar only appears when there are 2+ buffers. With a single buffer (e.g., `revim file1.txt`), the editor looks identical to the current behavior — no viewport height change, no tabs row.
- Running `just dev` with no arguments now opens 2 demo buffers (`demo-content.md` and `demo-scratch.md`) so the tabs bar is always visible during development. This is a change from the previous single-buffer default.
- The tabs bar is rendered entirely in Rust within `render_frame_internal`. No new NAPI functions are needed for the tabs bar itself; the existing `getBufferCount()` and `getCurrentBufferIndex()` NAPI functions are not used for rendering (the data is read directly from `TuiState` inside the lock).
- Buffer indices in the tabs bar are 1-based (matching Vim convention), even though the internal `active` index is 0-based.
- The `open_buffer` NAPI function does NOT switch to the new buffer. The tabs bar still updates because `render_frame_internal()` reads `buffers.len()` and shows the tabs bar whenever there are 2+ buffers, regardless of which buffer is active.
- The status bar continues to show the filename of the active buffer regardless of whether the tabs bar is visible — matching Vim behavior where both the tab line and status line show filename information.