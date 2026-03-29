# ReVim

A high-performance vim editor built with Rust and TypeScript. The architecture uses a tiny Rust library for UI rendering (ratatui), loaded by Bun runtime for optimal performance.

## Features

- **NAPI-RS FFI POC** — Proof-of-concept demonstrating TypeScript↔Rust FFI via NAPI-RS with sync/async calls and event subscriptions ([story](stories/001-napi-ffi-poc/story.md))
- **Basic TUI** — Terminal UI with ratatui, demo text, and cursor movement controlled by TypeScript via event-driven architecture ([story](stories/002-add-ratatui-tui/story.md))
- **Terminal Testing Framework** — E2E tests using @microsoft/tui-test for terminal automation, snapshot testing for rendered output, and Rust unit tests for rendering logic ([story](stories/003-add-terminal-testing/story.md))
- **Fork vim-monaco** — Port vim-monaco's TypeScript vim state machine (motions, operators, keymaps, ex commands) into `app/src/vim/`, strip all browser/Monaco dependencies, and wire to the Rust/ratatui backend via a new `TerminalAdapter` and NAPI-RS FFI surface ([story](stories/005-fork-vim-monaco/story.md))
- **Ctrl+C exit and visual mode** — Fix Ctrl+C exit (ThreadsafeFunction unref + synchronous process.exit), and render charwise/linewise/blockwise visual selection in the TUI ([story](stories/006-ctrl-c-exit-visual-mode/story.md))
- **Undo/redo** — Delta-based document history in the Rust TUI layer; `u`, `<C-r>`, and `U` perform real undo/redo instead of no-ops ([story](stories/007-add-undo-redo/story.md))

## Non-Goals

- Full vim compatibility (aiming for vim-inspired, not vim-compatible)
- GUI versions (terminal-only for now)
- Plugin system (future consideration)

## Known Limitations

- No cross-platform binary builds configured
- No vim status bar / mode indicator in the TUI yet
- No real viewport semantics
  - separate viewport state from cursor state
  - make scrollTo, scrollToLine, getScrollInfo, and getVisibleLines behave like an editor window
- No search and prompt UX coverage
  - add E2E coverage for /, n, N, search highlight behavior, and prompt scroll restore
- No ex command coverage
  - add E2E tests for a small supported subset like :w, :q, :sort, :s
  - explicitly gate/disable unsupported commands
- No unicode editing regression coverage
  - add tests for multibyte characters around movement, replace, delete, and range operations
