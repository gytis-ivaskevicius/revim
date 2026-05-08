# Status Bar Feature Completion

## Context

The status bar MVP (story 008) renders mode label and key buffer. Story 010 wired `startPrompt` for `/`/`?` search and `:` ex commands. However, several `IStatusBar` methods remain no-ops, and the status bar lacks standard vim information displays. The known limitations in `docs/product.md` list five deferred items; one (`startPrompt` for `:`) is already implemented and should be removed from the list. This story implements the remaining four:

1. **`startDisplay` / `showNotification`** — Transient and one-shot messages are silently dropped. Ex commands like `:set`, `:registers`, `:version`, and substitution counts produce no visible output. The `displayMessage` method (used for macro recording indicator) also has no effect.
2. **Cursor position indicator** — No line:col display in the status bar.
3. **File name display** — No file path shown in the status bar.
4. **Status bar styling** — The status bar renders as plain text with default terminal colors, making it indistinguishable from editor content.

## Out of Scope

- `toggleVisibility` / `closeInput` — remain no-ops (only called on `dispose`).
- `startPrompt` for `:` — already implemented (story 010); removing stale entry from known limitations.
- Unicode-width-aware status bar layout — ASCII-range content only for now.
- Configurable status bar format string (e.g., `set statusline=...`) — future consideration.
- Right-aligned status bar sections via ratatui layout — line:col is right-aligned using string padding within a single `Paragraph`, not via separate ratatui layout constraints.
- Multiple status bar rows — single row only.

## Implementation approach

### Status bar layout

The status bar currently renders as a single `Paragraph::new(status_text.as_str())` with `Alignment::Left`. The new layout composes the status text in TypeScript as a single string with this structure:

```
{MODE}  {key_buffer}  {filename}                            {line}:{col}
```

- Mode and key buffer: existing behavior (e.g., `NORMAL  2d`).
- Filename: basename of `current_path` (or `[No Name]` if `current_path` is `null`/empty), separated by two spaces from the key buffer.
- Line:col: 1-indexed cursor position (`cursor_row + 1`:`cursor_col + 1`), right-aligned to fill the terminal width.

Right-alignment is achieved by padding with spaces between the left section and the line:col section. The TypeScript `TerminalStatusBar.update()` method computes the full string including padding, and `setStatusText` sends it to Rust as a single string.

No Rust layout changes are needed — the status bar `Paragraph` still renders a single left-aligned string. The padding spaces handle right-alignment.

### `startDisplay` — transient messages

`startDisplay(message)` shows the message in the status bar and returns a closer. When the closer is called (via `status-close-display`), the status bar restores the previous content.

Implementation in `TerminalStatusBar`:
- Add `displayState: { message: string } | null`.
- `startDisplay(message)`: set `displayState = { message }`, call `setStatusText(message)`, return a closer that sets `displayState = null` and calls `this.update()`.
- `update()`: if `displayState` is non-null, skip mode/buffer rendering and show `displayState.message` instead. This means display messages take priority over mode/buffer but are lower priority than prompt state (which already bypasses `update()`).

Priority order (highest wins): prompt > display > mode+buffer+filename+line:col.

### `showNotification` — one-shot messages

`showNotification(message)` shows the message in the status bar for a fixed duration, then restores the previous content.

Implementation in `TerminalStatusBar`:
- Add `notificationTimeout: ReturnType<typeof setTimeout> | null`.
- `showNotification(message)`: clear any existing timeout, call `setStatusText(message)`, set a timeout that calls `this.update()` after 3 seconds. The timeout restores the mode/buffer/filename/line:col display.
- On `clear()` or `setMode()`/`setKeyBuffer()` calls while a notification is active, clear the timeout first so the notification doesn't overwrite user-driven status changes.

Priority order: prompt > notification > display > mode+buffer+filename+line:col.

### Cursor position and filename in status bar

`TerminalStatusBar.update()` currently composes `modeLabel + "  " + keyBuffer`. The new composition is:

```
leftSection = modeLabel + (keyBuffer ? "  " + keyBuffer : "") + "  " + filename
rightSection = line + ":" + col
paddedRightSection = rightSection.padStart(terminalWidth - leftSection.length)
fullText = leftSection + paddedRightSection
```

Where:
- `filename` = `path.basename(getCurrentPath() ?? "") || "[No Name]"`
- `line` = `getCursorPos().line + 1` (1-indexed for display)
- `col` = `getCursorPos().ch + 1` (1-indexed for display)
- `terminalWidth` = obtained from a new N-API function `get_terminal_width()` that returns the current terminal width from the ratatui `Terminal` size.

If `leftSection.length + rightSection.length > terminalWidth`, the right section (line:col) is truncated from the left to fit. If the terminal is too narrow for any right section, omit it entirely.

The `update()` method needs to be called whenever the cursor moves or the file path changes. This is achieved by:
- Calling `this.update()` in `setMode()` and `setKeyBuffer()` (already done).
- Calling `this.update()` from a new `setCursorPos()` method on `TerminalStatusBar`, which `VimMode` calls after every key event that moves the cursor.
- Calling `this.update()` from a new `setFilePath()` method on `TerminalStatusBar`, which `index.ts` calls when the file path changes (on `loadFile` and `setCurrentPath`).

### Rust changes

One new N-API function:

```rust
#[napi]
pub fn get_terminal_width() -> Result<u16> {
    let ctx = TUI_CONTEXT.lock().map_err(to_napi_error)?;
    let context = ctx.as_ref().ok_or_else(|| to_napi_error("TUI not initialized"))?;
    let size = context.terminal.size().map_err(to_napi_error)?;
    Ok(size.width)
}
```

No other Rust changes — the status bar `Paragraph` still renders a single string.

### Status bar styling

The status bar currently renders as `Paragraph::new(status_text.as_str()).alignment(Alignment::Left)` with default `Style`. To make it visually distinct:

- Apply `Style::default().add_modifier(Modifier::REVERSED)` to the entire status bar `Paragraph`. This inverts foreground/background, making the status bar visually distinct from editor content (matching vim's default highlighted status bar).
- No per-section coloring — the entire row uses reversed style.

This is a single-line change in `render.rs`:
```rust
let status_bar = Paragraph::new(status_text.as_str())
    .alignment(Alignment::Left)
    .style(Style::default().add_modifier(Modifier::REVERSED));
```

### `IStatusBar` interface additions

Add two new methods to `IStatusBar` in `statusbar.ts`:

```typescript
setCursorPos(line: number, col: number): void
setFilePath(path: string | null): void
```

`VimMode.handleKey` already calls `statusBar.setKeyBuffer()` on every key. After the key is processed, `VimMode` should also call `statusBar.setCursorPos(getCursorPos().line, getCursorPos().ch)` to update the cursor position display. This is done by reading the cursor position from the adapter after each key event.

For file path, `index.ts` calls `loadFile(targetPath)` and then `setCurrentPath(targetPath)` on successful load. After these calls, it should also call `statusBar.setFilePath(targetPath)`.

## Tasks

### Task 1 - Implement `startDisplay` and `showNotification` in `TerminalStatusBar`

Modify `app/src/vim/terminal-status-bar.ts`.

Add `displayState` and `notificationTimeout` fields. Implement `startDisplay` and `showNotification` per the approach above. Update `update()` to check `displayState` before rendering mode/buffer/filename/line:col.

#### Acceptance Criteria

- `startDisplay("3 substitutions on 2 lines")` called
  - → `setStatusText` is called with `"3 substitutions on 2 lines"`
  - → `isPrompting()` returns `false` (display does not enter prompt state)

- Closer returned by `startDisplay` is called
  - → `setStatusText` is called with the mode label (e.g., `"NORMAL"`)
  - → display message is no longer visible

- `startDisplay` called while a previous display is active
  - → new message replaces the previous one
  - → the previous closer, when called, restores the current display (not the older one)

- `showNotification("E21: Cannot make changes")` called
  - → `setStatusText` is called with `"E21: Cannot make changes"`

- After 3 seconds following `showNotification`
  - → `setStatusText` is called with the mode label (notification auto-clears)

- `showNotification` called while a previous notification is still visible
  - → previous notification timeout is cleared
  - → new message replaces the old one immediately

- `setMode({ mode: "insert" })` called while a notification is still visible
  - → notification timeout is cleared
  - → `setStatusText` is called with `"INSERT"` (notification is replaced by mode change)

- `startDisplay("message")` called, then `showNotification("note")` called
  - → notification takes priority: `setStatusText` is called with `"note"`
  - → after notification clears, display message is NOT restored (notification clears to mode/buffer, not to display)

- `startPrompt("/", "", options)` called while a display message is active
  - → prompt takes priority: `setStatusText` is called with `"/"`
  - → when prompt closes, display message is NOT restored (prompt closes to mode/buffer, not to display)

#### Non-Automatable

None.

---

### Task 2 - Add cursor position and filename to status bar

Modify `app/src/vim/terminal-status-bar.ts`, `app/src/vim/statusbar.ts`, `app/src/vim/index.ts`, and `lib/src/tui/api.rs`.

Add `get_terminal_width` N-API function in Rust. Add `setCursorPos` and `setFilePath` methods to `IStatusBar` and `TerminalStatusBar`. Update `update()` to compose the full status bar string with filename and line:col.

Wire `setCursorPos` calls in `VimMode.handleKey` (after key processing) and `setFilePath` calls in `index.ts` (after `loadFile`/`setCurrentPath`).

#### Acceptance Criteria

- App started with file `/tmp/test.txt`
  - → status bar shows `"NORMAL  /tmp/test.txt"` followed by spaces and `"1:1"` (cursor at line 0, col 0 → displayed as 1:1)

- App started with no file (demo content)
  - → status bar shows `"NORMAL  [No Name]"` followed by spaces and `"1:1"`

- Cursor moved to line 5, column 3 (0-indexed)
  - → status bar shows `"6:4"` (1-indexed display)

- `setMode({ mode: "insert" })` called
  - → status bar shows `"INSERT  [No Name]"` followed by spaces and cursor position

- `setKeyBuffer("2d")` called
  - → status bar shows `"NORMAL  2d  [No Name]"` followed by spaces and cursor position

- Terminal width is 40 columns, left section is 25 chars, right section is 5 chars
  - → right section is padded with 10 spaces to fill the row

- Terminal width is 20 columns, left section is 18 chars, right section is 5 chars
  - → right section is truncated or omitted to avoid overflow

- `get_terminal_width()` returns the current terminal width as a `u16`
  - → value matches the width reported by ratatui's `Terminal::size()`

#### Non-Automatable

None.

---

### Task 3 - Apply reversed style to status bar

Modify `lib/src/tui/render.rs`.

Add `Style::default().add_modifier(Modifier::REVERSED)` to the status bar `Paragraph`.

#### Acceptance Criteria

- App started normally
  - → status bar row renders with inverted foreground/background colors (REVERSED modifier applied)
  - → editor content area is unaffected (no style change to editor paragraph)

- Snapshot test: status bar text is visible and the snapshot includes color/style information
  - → `toMatchSnapshot({ includeColors: true })` captures the reversed style

#### Non-Automatable

Visual check: the status bar should appear as a highlighted bar at the bottom of the terminal, visually distinct from the editor area.

---

### Task 4 - Wire `startDisplay` and `showNotification` into `VimMode` event handlers

The `VimMode.initListeners` in `app/src/vim/index.ts` already listens for `"status-display"`, `"status-close-display"`, and `"status-notify"` events and calls the corresponding `IStatusBar` methods. Since `startDisplay` and `showNotification` were no-ops, these events had no visible effect. After Task 1 makes them functional, the existing wiring will work. However, verify that:

1. `displayMessage` in `adapter.ts` dispatches `"status-display"` with a unique `id`, and the closer dispatches `"status-close-display"` with the same `id`. The `VimMode` listener stores the closer returned by `startDisplay` in `this.closers_` keyed by `id`, and `"status-close-display"` calls the closer. This is already implemented and should work as-is.

2. `showConfirm` in `search-utils.ts` calls `adapter.openNotification(message)`, which dispatches `"status-notify"`. The `VimMode` listener calls `statusBar.showNotification(msg)`. This is already wired and should work as-is.

No code changes needed in this task — it's a verification task with E2E tests.

#### Acceptance Criteria

- `:set number` executed (an unknown option that triggers `showConfirm`)
  - → status bar shows the notification message (e.g., `"no such option: number"`) for 3 seconds, then restores the mode label

- `:registers` executed
  - → status bar shows register contents as a notification message

- Macro recording started with `qa`
  - → status bar shows `(recording)[a]` via `displayMessage`
  - → when recording stops with `q`, the display message is cleared and mode label restored

- `:s/foo/bar/g` executed with matches
  - → status bar shows substitution count (e.g., `"3 substitutions on 2 lines"`) via `startDisplay`

#### Non-Automatable

None.

---

### Task 5 - Update known limitations in `docs/product.md`

Remove the stale `startPrompt` / `status-close-prompt` entry from the status bar known limitations (it's already implemented). Update the remaining entries to reflect that `startDisplay`, `showNotification`, cursor position, filename, and status bar styling are now implemented.

#### Acceptance Criteria

- `docs/product.md` known limitations no longer lists `startPrompt` / `status-close-prompt` as deferred
- `docs/product.md` known limitations no longer lists `startDisplay`, `showNotification`, cursor position, filename, or status bar styling as deferred
- `docs/product.md` features list includes an entry for this story

#### Non-Automatable

None.

## Technical Context

- ratatui `0.30.0` — `Style::default().add_modifier(Modifier::REVERSED)` is stable; `Paragraph::style()` setter is available.
- napi-rs `3.8.3` / napi-derive `3.5.2` — `get_terminal_width` follows the same pattern as `get_cursor_pos` (read-only, acquires `TUI_CONTEXT` lock, reads terminal size).
- `getCursorPos()` and `getCurrentPath()` are already exposed via N-API and imported in `adapter.ts`.
- `path.basename()` is available in Bun/Node.js runtime — no additional dependency needed.
- `TerminalStatusBar` already imports `setStatusText` from `@revim/lib`; new imports needed: `getCursorPos`, `getCurrentPath`, `getTerminalWidth`.
- The `VimMode.handleKey` method in `app/src/vim/index.ts` is the single key routing point — adding `statusBar.setCursorPos()` after key processing ensures the cursor position is always up to date.
- `setTimeout` is available in the Bun runtime; `ReturnType<typeof setTimeout>` is the correct type for the timeout ID.

## Notes

- The `startDisplay` closer must be stored in `VimMode.closers_` by the `"status-display"` listener. The existing code in `index.ts` already does this (`this.closers_.set(id, closer)`). When `"status-close-display"` fires, it calls the closer, which sets `displayState = null` and calls `this.update()`. This means display messages are explicitly closed by the vim layer, not auto-expiring.
- `showNotification` messages auto-expire after 3 seconds. This matches vim's behavior for short-lived messages (e.g., `:set` output). The timeout is cleared if a higher-priority state change occurs (new mode, new key buffer, prompt, display).
- The priority order for status bar content is: prompt (highest) > notification > display > mode+buffer+filename+line:col (lowest). When a higher-priority state ends, the next lower-priority state is shown.
- `TerminalStatusBar.update()` must check all states in priority order. If `promptState` is active, `update()` should not be called (prompt manages its own text via `setStatusText`). If `notificationTimeout` is active, `update()` should not overwrite the notification. If `displayState` is active, `update()` shows the display message. Otherwise, it shows the composed mode+buffer+filename+line:col.
- The filename display uses `path.basename()` to show only the filename, not the full path. This matches vim's default status bar behavior (`%f` shows relative path, `%t` shows tail; we use tail for simplicity).
- Cursor position is 1-indexed in the display (vim convention: `line:col` where line starts at 1, col starts at 1). The N-API `getCursorPos()` returns 0-indexed values, so `+1` is needed.
- `get_terminal_width` reads from `context.terminal.size()` which returns the current terminal dimensions. This is called on every `update()` to compute padding. Since `update()` is called on every key event, this is frequent but lightweight (no rendering, just reading a stored value).