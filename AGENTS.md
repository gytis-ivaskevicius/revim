# AGENTS

## Code map
- `app/src/index.ts` — app entry, keyboard listener, shutdown path
- `app/src/terminal-key.ts` — terminal key normalization/encoding boundary
- `app/src/vim/` — Vim layer port; start with:
  - `keymap_vim.ts` — adapter bootstrap, key translation, selection syncing
  - `command-dispatcher.ts` — motion/operator orchestration
  - `motions.ts`, `operators.ts` — core motion/operator behavior
  - `motion-paragraph.ts` — paragraph/sentence motions for `{`, `}`, `(`, `)`
  - `default-key-map.ts` — Vim keybinding table
- `app/src/log.ts` — logging API (initLog, log); wire `--log <path>` in index.ts
- `lib/src/tui/log.rs` — Rust logging (setLogFd, appendLog, revim_log! macro)
- `lib/src/tui/api.rs` — N-API boundary for cursor, buffer, keyboard listener
- `lib/src/tui/state.rs` — demo buffer, cursor state, clipping rules
- `lib/src/tui/render.rs` — terminal rendering and cursor placement
- `app/tests/e2e/` — terminal E2E suite; `test-utils.ts` sets shared config

## Gotchas
- For visual/block selection bugs, inspect TS selection shaping and Rust application together.
- `@microsoft/tui-test` can fail on transient Cargo dirs under `lib/target` during cache copy.
- `@microsoft/tui-test` can also flake when worker reuse is too aggressive; if the suite starts from a blank `>` prompt or tests contaminate each other, inspect `tui-test.config.ts` worker count before assuming an app regression.
