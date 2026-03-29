# Add Status Bar (MVP)

## Context

The vim-monaco port introduced a fully-specified `IStatusBar` interface (`app/src/vim/statusbar.ts`) whose methods are called throughout `VimMode` in response to mode changes and key events. Today every call is silently dropped because no implementation is passed to `VimMode`. This story wires a minimal terminal status bar that shows the current vim mode and the pending key-chord buffer so users can see what mode they are in and what keys they have typed.

## Out of Scope

- `startDisplay` / `status-display` / `status-close-display` — transient ex-command messages (e.g., substitution counts). `startDisplay` returns a no-op closer; `status-close-display` is handled implicitly because the closer is a no-op.
- `startPrompt` / `status-prompt` / `status-close-prompt` — interactive command-line prompt for `/`, `?`, `:` searches and confirm replacements. `startPrompt` returns a no-op closer; `status-close-prompt` is handled implicitly.
- `showNotification` / `status-notify` — one-shot notification messages from ex commands (e.g., `:colorscheme` output).
- `toggleVisibility`, `closeInput`, `clear` — called together from the `dispose` event when `VimMode.disable()` is invoked; all three must be no-ops that do not throw, but no visual behavior is required.
- Cursor-position indicators (line:col) in the status bar
- File name display
- Search highlight state in the status bar
- Unicode-width-aware status bar text (ASCII-range content only for MVP)
- Scrolling/viewport adjustment to account for the reserved row

## Implementation approach

### Layout change

`render.rs` currently draws a single `Paragraph` widget that fills the entire terminal area inside the block border. The status bar occupies the **last row below the block border** (outside the bordered widget). A ratatui vertical `Layout` splits the full terminal area into two constraints:

- `Constraint::Min(0)` — editor area (gets all available space minus the status row)
- `Constraint::Length(1)` — status bar row (always exactly 1 row tall)

The existing bordered `Paragraph` is rendered into the first chunk. The status bar `Paragraph` is rendered into the second chunk without a border. The cursor is still positioned inside the editor area using `inner_area` of the block.

The status bar `Paragraph` left-aligns mode and key buffer: `" {MODE_LABEL}  {key_buffer}"` where `MODE_LABEL` is one of:

| mode string | display label |
|---|---|
| `"normal"` | `NORMAL` |
| `"insert"` | `INSERT` |
| `"visual"` | `VISUAL` |
| `"visual-line"` | `V-LINE` |
| `"visual-block"` | `V-BLOCK` |
| `"replace"` | `REPLACE` |
| empty / unknown | `NORMAL` |

The key buffer is appended after two spaces. If the buffer is empty, nothing extra is shown.

### N-API surface

One new function is added to `lib/src/tui/api.rs`:

```rust
#[napi]
pub fn set_status_text(text: String) -> Result<()>
```

It stores `text` in `TuiState.status_text: String` and calls `render_frame_internal()`.

`TuiState` gains one new field:

```rust
pub status_text: String,  // defaults to ""
```

TypeScript calls `setStatusText` directly — it does not go through `setVimMode`. The existing `set_vim_mode` and `set_replace_mode` stubs remain as no-ops (already calling `render_frame_internal`, no change needed).

### TypeScript status bar implementation

A new class `TerminalStatusBar` is created in `app/src/vim/terminal-status-bar.ts` that implements `IStatusBar`. It calls `setStatusText` on each `setMode` or `setKeyBuffer` call, composing the status text as described above. All other `IStatusBar` methods are no-ops.

`TerminalStatusBar` owns the composed text state (`mode` + `keyBuffer`) and recomputes on every setter call.

`VimMode` is instantiated in `app/src/index.ts` with a `new TerminalStatusBar()` passed as the `statusBar` argument.

## Tasks

### Task 1 - Rust: TuiState and render changes

#### Acceptance Criteria

- `TuiState` initialized with `status_text: ""` + app starts normally
  - → `getByText("Welcome to ReVim!")` is visible
  - → initial status bar row shows `NORMAL` (via TypeScript calling `setStatusText` on init)

- `set_status_text("INSERT")` called + frame rendered
  - → bottom row of terminal shows `INSERT`
  - → editor text area is unobscured (no content line hidden by the status bar)

- terminal resized (60 columns) + frame rendered
  - → status bar fills the full width of the terminal row, no layout panic

#### Non-Automatable

- Visual check: status bar row uses default terminal colors (no explicit color styling in MVP). Snapshot test covers the rendered text content.

---

### Task 2 - Rust: `set_status_text` N-API function

#### Acceptance Criteria

- `set_status_text("")` called
  - → status bar row is empty / blank (no label shown)

- `set_status_text("NORMAL")` called
  - → bottom row shows `NORMAL`

- `set_status_text("INSERT  ab")` called
  - → bottom row shows `INSERT  ab`

- N-API binding is exported from `@revim/lib` (the generated TypeScript bindings include `setStatusText`)

#### Non-Automatable

N/A

---

### Task 3 - TypeScript: `TerminalStatusBar` implementation

#### Acceptance Criteria

- `new TerminalStatusBar()` created + `.setMode({ mode: "normal" })` called
  - → `setStatusText` is called with a string containing `"NORMAL"`

- `.setMode({ mode: "insert" })` called
  - → `setStatusText` is called with a string containing `"INSERT"`

- `.setMode({ mode: "visual", subMode: "linewise" })` called
  - → `setStatusText` is called with a string containing `"V-LINE"`

- `.setMode({ mode: "visual", subMode: "blockwise" })` called
  - → `setStatusText` is called with a string containing `"V-BLOCK"`

- `.setMode({ mode: "visual" })` called (no subMode)
  - → `setStatusText` is called with a string containing `"VISUAL"`

- `.setMode({ mode: "replace" })` called
  - → `setStatusText` is called with a string containing `"REPLACE"`

- `.setMode({ mode: "normal" })` + `.setKeyBuffer("2d")` called
  - → `setStatusText` is called with a string containing both `"NORMAL"` and `"2d"`

- `.setKeyBuffer("")` called after `setKeyBuffer("2d")`
  - → `setStatusText` is called with a string not containing `"2d"`

- All other `IStatusBar` methods called (`startDisplay`, `startPrompt`, `showNotification`, `toggleVisibility`, `closeInput`, `clear`)
  - → no error thrown, no crash

#### Non-Automatable

N/A

---

### Task 4 - TypeScript: wire `TerminalStatusBar` into `index.ts`

#### Acceptance Criteria

- app started fresh (E2E)
  - → bottom terminal row shows `NORMAL`

- app started + `i` pressed to enter insert mode
  - → bottom terminal row shows `INSERT`

- in insert mode + `<Esc>` pressed
  - → bottom terminal row shows `NORMAL`

- app started + `v` pressed for visual mode
  - → bottom terminal row shows `VISUAL`

- app started + `V` pressed for visual-line mode
  - → bottom terminal row shows `V-LINE`

- app started + `<C-v>` pressed for visual-block mode
  - → bottom terminal row shows `V-BLOCK`

- app started + `2d` typed (pending operator + count)
  - → bottom terminal row shows `NORMAL` and `2d`

- command completed (`2dd`)
  - → key buffer portion clears from the status bar

- app started + `:` pressed (ex command entry)
  - → key buffer is reset to empty (`:` itself is not shown in the buffer); status bar shows `NORMAL` with no pending keys

- snapshot taken after pressing `i`
  - → matches stored snapshot (status bar row visible with `INSERT`)

#### Non-Automatable

- Colors: the status bar row uses terminal default foreground/background for MVP. No explicit color assertions.

## Technical Context

- ratatui `0.30.0` — `Layout::vertical` with `Constraint::Min` / `Constraint::Length` are stable since 0.22; no breaking changes in 0.30.x relevant here.
- napi-rs `3.8.3` / napi-derive `3.5.2` — new `#[napi]` function follows same pattern as all existing functions in `api.rs`; no additional crate dependencies needed.
- `@microsoft/tui-test` — `getByText` can match partial row content; use it to assert status bar row text in E2E tests.

## Notes

- `TerminalStatusBar` must call `setStatusText` eagerly on construction (or on first `setMode`) so the status bar is never blank when the app initialises. The recommended approach is to call `setMode({ mode: "normal" })` from `index.ts` after constructing the `VimMode`, or have `TerminalStatusBar` call `setStatusText` in its constructor with an initial `"NORMAL"` label.
- The status bar text is ASCII-range only for MVP; no need for unicode width calculations.
- `setVimMode` and `setReplaceMode` remain as no-ops calling `render_frame_internal()` — they are not changed in this story.
- The `vim-keypress` event fires for **every** key including `:`. `VimMode` resets `keyBuffer_` to `""` and calls `setKeyBuffer("")` when the key is `":"` — so the colon is never accumulated into the buffer. `TerminalStatusBar` must handle `setKeyBuffer("")` gracefully (clear the buffer portion of the status text).
- `vim-command-done` is the primary buffer-clearing signal; it fires after both normal commands (e.g., `dd`, `2j`) and after operator-pending sequences complete. The key buffer in `VimMode` is reset to `""` before `setKeyBuffer("")` is called.
- The `dispose` event fires when `VimMode.disable()` is called (e.g., on app shutdown). It calls `toggleVisibility(false)`, `closeInput()`, and `clear()` in sequence. All three must be safe no-ops in `TerminalStatusBar` so shutdown doesn't throw.
