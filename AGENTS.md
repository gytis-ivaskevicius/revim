# AGENTS

## Code map
- `app/src/index.ts` — app entry, keyboard listener, shutdown path
- `app/src/terminal-key.ts` — terminal key normalization/encoding boundary
- `app/src/vim/` — Vim layer port; start with:
  - `keymap_vim.ts` — selection translation (`updateCmSelection`, `makeCmSelection`)
  - `command-dispatcher.ts` — motion/operator orchestration
  - `motions.ts`, `operators.ts` — behavior changes usually land here
- `lib/src/tui.rs` — native TUI render/buffer/selection application
- `app/tests/e2e/` — terminal E2E suite; `test-utils.ts` sets shared config

## Gotchas
- For visual/block selection bugs, inspect TS selection shaping and Rust application together.
- `@microsoft/tui-test` can fail on transient Cargo dirs under `lib/target` during cache copy.
