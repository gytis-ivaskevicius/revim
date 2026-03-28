# ReVim

A high-performance vim editor built with Rust and TypeScript. The architecture uses a tiny Rust library for UI rendering (ratatui), loaded by Bun runtime for optimal performance.

## Features

- **NAPI-RS FFI POC** — Proof-of-concept demonstrating TypeScript↔Rust FFI via NAPI-RS with sync/async calls and event subscriptions ([story](stories/001-napi-ffi-poc/story.md))
- **Basic TUI** — Terminal UI with ratatui, demo text, and cursor movement controlled by TypeScript via event-driven architecture ([story](stories/002-add-ratatui-tui/story.md))
- **Terminal Testing Framework** — E2E tests using @microsoft/tui-test for terminal automation, snapshot testing for rendered output, and Rust unit tests for rendering logic ([story](stories/003-add-terminal-testing/story.md))
- **Fork vim-monaco** — Port vim-monaco's TypeScript vim state machine (motions, operators, keymaps, ex commands) into `app/src/vim/`, strip all browser/Monaco dependencies, and wire to the Rust/ratatui backend via a new `TerminalAdapter` and NAPI-RS FFI surface ([story](stories/005-fork-vim-monaco/story.md))

## Non-Goals

- Full vim compatibility (aiming for vim-inspired, not vim-compatible)
- GUI versions (terminal-only for now)
- Plugin system (future consideration)

## Known Limitations

- Basic TUI only - no text editing functionality yet (vim-monaco fork in progress)
- No cross-platform binary builds configured