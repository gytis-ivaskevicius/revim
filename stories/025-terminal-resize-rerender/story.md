# Terminal resize triggers re-render

## Context

When the terminal is resized, crossterm emits `Event::Resize` events, but the keyboard listener thread in `api.rs` only processes `Event::Key` events — all other event types (including resize) are silently discarded. The rendering pipeline (`render_frame_internal`) only runs when a NAPI function explicitly calls it, which happens on key presses and editor actions. This means the display stays stale after a terminal resize until the user presses a key. The viewport height, scroll position, and status bar layout are all computed from the current terminal dimensions inside `render_frame_internal`, so a re-render is all that's needed to produce a correct display after a resize.

## Out of Scope

- Debouncing rapid resize events beyond the simple "coalesce consecutive resizes in the queue" optimization
- Cursor repositioning beyond what `adjust_scroll` already does (keeping cursor visible)
- Any changes to the ratatui `Terminal` backend or crossterm version

## Implementation approach

**Rust side — push resize events into the existing keyboard queue:**

The keyboard listener thread (`start_keyboard_listener` in `api.rs`) currently matches only `Event::Key`. Change the `if let` to a `match` that also handles `Event::Resize(_, _)`. When a resize event arrives, push a synthetic `KeyboardEvent { key: "Resize", modifiers: [] }` into the same `KEYBOARD_QUEUE` that key events use. Before pushing, check whether the last event already in the queue is also a `"Resize"` event — if so, replace it instead of appending. This coalesces rapid consecutive resizes (common during window dragging) so only the latest dimensions are rendered.

**TypeScript side — handle the "Resize" event in the main loop:**

In `index.ts`, after pulling an event from `waitForKeyboardEvent`, check whether `event.key === "Resize"`. If so:

1. If the status bar is **not** prompting (`!statusBar.isPrompting()`), call `statusBar.refresh()` — this recomputes the status bar text with the new `getTerminalWidth()` and calls `setStatusText`, which calls `render_frame_internal`.
2. If the status bar **is** prompting, call `focusEditor()` — this calls `render_frame_internal` directly, which re-renders the prompt text at the new width. The prompt text itself (`prefix + query`) is width-independent, so no TypeScript-side recomputation is needed.

Then `continue` the loop without passing the event to `processKeyEvent`.

**Status bar — add `refresh()` method:**

Add a public `refresh()` method to `TerminalStatusBar` that calls the private `update()` method. This gives the resize handler a clean way to recompute the status bar layout without exposing internal details.

**Why not call `render_frame_internal` directly from the Rust listener thread?**

The AGENTS.md gotcha warns that `render_frame_internal` acquires `TUI_CONTEXT.lock()`. Calling it from the listener thread while the JS thread might hold that lock risks a deadlock with `std::sync::Mutex`. Routing the event through the JS event loop avoids this entirely.

## Tasks

### Task 1 — Handle `Event::Resize` in the Rust keyboard listener

- Terminal resized (e.g., window drag) + crossterm emits `Event::Resize(120, 40)`
  - → a `KeyboardEvent { key: "Resize", modifiers: [] }` is pushed to `KEYBOARD_QUEUE`
  - → `KEYBOARD_QUEUE.condvar.notify_one()` wakes the JS thread
- Two rapid resize events arrive before the JS thread processes either
  - → only one `"Resize"` event remains in the queue (the earlier one is replaced)
- A key event arrives between two resize events
  - → all three events stay in the queue in order (key-resize coalescing only merges consecutive resizes)
- TUI is shutting down (`TUI_RUNNING` is false)
  - → the listener thread exits its loop; no resize event is pushed

### Task 2 — Process resize events in the TypeScript main loop

- Resize event received + status bar is in normal mode (no prompt active)
  - → `statusBar.refresh()` is called
  - → `update()` recomputes status text using the new `getTerminalWidth()`
  - → `setStatusText()` stores the new text and calls `render_frame_internal`
  - → the display updates to reflect the new terminal dimensions
- Resize event received + status bar is prompting (search or ex command)
  - → `focusEditor()` is called
  - → `render_frame_internal` re-renders the prompt text at the new width
  - → the prompt remains intact and correctly positioned
- Resize event received + the event loop is in the `catch` block (error state)
  - → the resize event is processed normally on the next iteration (the error handler does not consume the event)

### Task 3 — Add `refresh()` method to `TerminalStatusBar`

- `statusBar.refresh()` called when no prompt is active and no notification is displayed
  - → `update()` runs, composing the mode + filename + line:col string with current `getTerminalWidth()`
  - → `setStatusText()` is called with the recomputed string
- `statusBar.refresh()` called while a prompt is active
  - → `update()` returns early (prompt manages its own text)
  - → no status text change occurs

### Task 4 — E2E test for terminal resize re-render

- App started at 80×30 + "Welcome to ReVim!" visible + terminal resized to 120×40
  - → after the resize event is processed, the display updates to reflect the new dimensions
  - → the status bar is reformatted for the wider terminal
  - → a snapshot matches the expected layout at 120×40
- App started at 80×30 + terminal resized to 40×15 (smaller)
  - → the display updates; the status bar reformats for the narrower terminal
  - → the cursor remains visible (scroll adjusts via `adjust_scroll`)

## Technical Context

- **crossterm 0.29.0** — already a direct dependency in `lib/Cargo.toml`; emits `Event::Resize(u16, u16)` via `event::read()`
- **ratatui 0.30.0** — `Terminal::draw()` calls `autoresize()` internally, which reads the new size from crossterm's backend; no explicit resize call needed
- **`@microsoft/tui-test`** — provides `terminal.resize(columns, rows)` for E2E tests
- **`focusEditor`** — existing NAPI function (`focus_editor` in Rust) that calls `render_frame_internal`; already exported from `@revim/lib` but not yet imported in `index.ts`

## Notes

- The `"Resize"` key name is a synthetic event — it will never be produced by a real key press, so there is no risk of collision with actual keyboard input.
- `render_frame_internal` already reads `terminal.size()` on every call and updates `viewport_height` + calls `adjust_scroll`, so no additional scroll or cursor logic is needed on the Rust side.
- The status bar's `update()` method already calls `getTerminalWidth()` on every invocation, so `refresh()` naturally picks up the new width.
- During a prompt, the prompt text (`prefix + query`) is width-independent, so re-rendering via `focusEditor()` is sufficient — no TypeScript-side prompt recomputation is needed.