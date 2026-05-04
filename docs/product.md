# ReVim

A high-performance vim editor built with Rust and TypeScript. The architecture uses a tiny Rust library for UI rendering (ratatui), loaded by Bun runtime for optimal performance.

## Features

- **NAPI-RS FFI POC** — Proof-of-concept demonstrating TypeScript↔Rust FFI via NAPI-RS with sync/async calls and event subscriptions ([story](stories/001-napi-ffi-poc/story.md))
- **Basic TUI** — Terminal UI with ratatui, demo text, and cursor movement controlled by TypeScript via event-driven architecture ([story](stories/002-add-ratatui-tui/story.md))
- **Terminal Testing Framework** — E2E tests using @microsoft/tui-test for terminal automation, snapshot testing for rendered output, and Rust unit tests for rendering logic ([story](stories/003-add-terminal-testing/story.md))
- **Fork vim-monaco** — Port vim-monaco's TypeScript vim state machine (motions, operators, keymaps, ex commands) into `app/src/vim/`, strip all browser/Monaco dependencies, and wire to the Rust/ratatui backend via a new `TerminalAdapter` and NAPI-RS FFI surface ([story](stories/005-fork-vim-monaco/story.md))
- **Ctrl+C exit and visual mode** — Fix Ctrl+C exit (ThreadsafeFunction unref + synchronous process.exit), and render charwise/linewise/blockwise visual selection in the TUI ([story](stories/006-ctrl-c-exit-visual-mode/story.md))
- **Undo/redo** — Delta-based document history in the Rust TUI layer; `u`, `<C-r>`, and `U` perform real undo/redo instead of no-ops ([story](stories/007-add-undo-redo/story.md))
- **Status bar (MVP)** — Terminal status bar showing current vim mode and pending key-chord buffer; `IStatusBar` interface wired via `TerminalStatusBar` and a new `setStatusText` N-API function ([story](stories/008-add-status-bar/story.md))
- **Fix cursor visibility and undo regressions** — Eliminate cursor double-inversion (hardware cursor + REVERSED span cancelled each other in normal mode), fix `r<char>` undo missing undo stop, and add targeted E2E regression tests ([story](stories/009-fix-cursor-undo-regressions/story.md))
- **Vim search** — `/`, `?`, `n`, `N` with status-bar prompt UX, incremental highlights, and wrap-around; `startPrompt` wired in `TerminalStatusBar` so the search query is captured in the terminal ([story](stories/010-vim-search/story.md))
- **Scroll support** — Expanded demo buffer (~50 lines), `scroll_top` viewport state in Rust, auto-scroll cursor-follows-viewport, `zz`/`zt`/`zb` viewport positioning, and live `get_scroll_info`/`get_visible_lines` API ([story](stories/012-add-scroll-support/story.md))

- **Logging API** — File-based debug logging from both Rust and TypeScript; enabled via `--log /path/to/file` CLI flag; `withLog(path)` helper for E2E tests ([story](stories/013-add-logging-api/story.md))
- **Improve testing infrastructure DRY** — Centralize `pressKeys`, `visibleBuffer`, `delay` helpers in `test-utils.ts` via a unified `Keys` utility class; eliminate duplicated key-handling code across 7+ test files ([story](stories/014-improve-testing-dry-keys/story.md))
- **Code review fixes** — Fix missing key mappings in `decodeKey` (Tab, Delete, Home, End, PageUp, PageDown, Shift-prefixed), log swallowed errors in `onPromptClose`, skip log formatting when disabled, replace custom Gregorian calendar with `chrono`, add `closeLog()` for shutdown, extract `applyKeyToQuery` helper, consolidate `dispatchKey`/`Keys.pressKey`, wrap `highlightTimeout` in a function ([story](stories/016-code-review-fixes/story.md))
- **Code review round-two fixes** — Fix Ctrl-U case mismatch in ex command handler, restructure ex command `onPromptKeyDown` with if/else if and close-first pattern, add Insert key to `decodeKey`, fix compound modifier handling in `decodeKey`, validate log file path, validate fd in `set_log_fd`, consistently recover from Mutex poisoning, remove unnecessary `_highlightTimeout` getter/setter, extract shared `TERMINAL_KEY_MAP` constant, un-export `dispatchKey`, split `close()` into `closePrompt()`/`setQuery()`, add circuit breaker for infinite error loop ([story](stories/017-code-review-round-two/story.md))
- **Code review cleanup** — Unify prompt closing so Enter is handled by `onKeyDown` (fixing double `onKeyUp`), remove misleading `!evt.shiftKey` check in `applyKeyToQuery`, eliminate `decodeKey` → `getEventKeyName` round-trip, consolidate search prompt history into `makePromptKeyDown`, rename `_highlightTimeout` to `pendingHighlightTimeoutId`, replace consecutive error counter with a time-based sliding window ([story](stories/018-code-review-cleanup/story.md))
- **CLI file opening** — Allow `revim <filepath>` to open a file for editing; move hardcoded demo content from Rust `state.rs` to `app/tests/fixtures/demo-content.md`; load the fixture by default when no file is passed; read file content in TypeScript and push it to the Rust buffer via the existing `setAllLines` N-API function ([story](stories/019-cli-file-open/story.md))

## Non-Goals

- Full vim compatibility (aiming for vim-inspired, not vim-compatible)
- GUI versions (terminal-only for now)
- Plugin system (future consideration)

## Known Limitations

- No cross-platform binary builds configured
- Status bar: mode indicator and key buffer wired (story 008); search prompt `/`/`?` wired (story 010); the following are deferred:
  - `startPrompt` / `status-close-prompt` for `:` — interactive command-line prompt for ex commands and confirm replacements
  - `startDisplay` / `status-close-display` — transient ex-command messages (e.g., substitution counts)
  - `showNotification` — one-shot notification messages from ex commands
  - Cursor position indicator (line:col) in the status bar
  - File name display in the status bar
  - Status bar colors / theming
- No ex command coverage
  - add E2E tests for a small supported subset like :w, :q, :sort, :s
  - explicitly gate/disable unsupported commands
- **Remove key alias mapping** — Rust `api.rs` now emits canonical key names (`"Up"`, `"Down"`, `"Left"`, `"Right"`, `"Esc"`) directly; the redundant `keyAliases` table in `terminal-key.ts` is deleted ([story](stories/011-remove-key-alias-mapping/story.md))
- No unicode editing regression coverage
  - add tests for multibyte characters around movement, replace, delete, and range operations
