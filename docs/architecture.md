---
description: Terminal vim adapter notes that are useful when changing FFI or editor integration.
---

# Architecture Notes

## Vim Adapter Verification

- `TerminalAdapter` construction depends on the TUI NAPI layer being initialized first because its constructor reads the cursor immediately.
- Manual verification used for story `005-fork-vim-monaco`:
  - `new TerminalAdapter()` succeeds after `initTui()`.
  - Event emitter flow works: `on("change", fn)`, `dispatch("change", ...)`, then `off("change", fn)` removes the handler.
  - FFI primitives behave directly through `@revim/lib` after `initTui()`:
    - `getLine(0)` returns the first demo line.
    - `setCursorPos(1, 0)` then `getCursorPos()` returns `{ line: 1, ch: 0 }`.
    - `replaceRange("X", 0, 0, 0, 0)` updates line 0.
    - `getLineCount()` returns the demo buffer line count.

## Input Model

- Terminal key events are normalized in `app/src/index.ts` and then routed through `VimMode.handleKey()`.
- Arrow keys should stay on the Vim path; do not add a second direct cursor-movement path in the app entrypoint.
- Rust `api.rs` emits canonical key names (`"Up"`, `"Down"`, `"Left"`, `"Right"`, `"Esc"`) directly from the `KeyCode` match arm. There is no alias table in TypeScript — `encodeTerminalKey` uses `event.key` verbatim.
