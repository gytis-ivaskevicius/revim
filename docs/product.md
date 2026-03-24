# ReVim

A high-performance vim editor built with Rust and TypeScript. The architecture uses a tiny Rust library for UI rendering (ratatui), loaded by Bun runtime for optimal performance.

## Features

- **NAPI-RS FFI POC** — Proof-of-concept demonstrating TypeScript↔Rust FFI via NAPI-RS with sync/async calls and event subscriptions ([story](stories/001-napi-ffi-poc/story.md))
- **Basic TUI** — Terminal UI with ratatui, demo text, and cursor movement controlled by TypeScript via event-driven architecture ([story](stories/002-add-ratatui-tui/story.md))

## Non-Goals

- Full vim compatibility (aiming for vim-inspired, not vim-compatible)
- GUI versions (terminal-only for now)
- Plugin system (future consideration)

## Known Limitations

- Basic TUI only - no text editing functionality yet
- No cross-platform binary builds configured