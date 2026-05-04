# Basic ex commands: :w, :q, and :wq

## Context

The TypeScript ex-command infrastructure is already wired for `:w` and `:e` — `defaultExCommandMap` registers `write`/`save`/`edit`, `ex-commands.ts` delegates to `EditorAdapter.commands.save`/`open`, and `VimMode` dispatches `save-file`/`open-file` events. What is missing is the Rust side (actually saving to disk and tracking the current file path) and the quit path (`:q`, `:wq`). This story connects the existing TypeScript plumbing to real file I/O in Rust.

## Out of Scope

- Dirty state tracking / unsaved-changes warnings on quit
- `:w !` (pipe to shell / sudo write)
- File format conversions, encoding changes, or backup files
- Full `showNotification` implementation in `TerminalStatusBar` — visible messages are delivered via `setStatusText` directly

## Implementation approach

1. **Rust: Track current file path**  
   Add `current_path: Option<String>` to `TuiState` in `lib/src/tui/state.rs`. Initialize to `None`. Update `load_file` in `lib/src/tui/api.rs` to always set `current_path` to the provided path, regardless of whether the file read succeeds (matching Vim's behavior where `:e newfile` sets the buffer name even before the file exists).

2. **Rust: Add N-API functions**  
   In `lib/src/tui/api.rs`, add three `#[napi]` functions:
   - `get_current_path() -> Result<Option<String>>`
   - `set_current_path(path: String) -> Result<()>`
   - `save_file(path: String) -> Result<()>` — acquires state lock, clones `demo_text`, drops the lock, writes lines joined by `\n` with a trailing newline. On I/O error returns `Err(to_napi_error(err))`. Never modifies the editor buffer on failure.

3. **TypeScript: Register `quit` command**  
   In `app/src/index.ts`, import `EditorAdapter` from `./vim` and register `EditorAdapter.commands.quit = () => shutdown(0)` after `shutdown` is defined.

4. **TypeScript: Add `quit` and `wq` to the command map**  
   In `app/src/vim/ex-command-dispatcher.ts`, add to `defaultExCommandMap`:
   - `{ name: "quit", shortName: "q" }`
   - `{ name: "wq", shortName: "wq" }`

5. **TypeScript: Add handlers in `ex-commands.ts`**  
   - `quit`: call `EditorAdapter.commands.quit?.()`. The `!` suffix appears in `argString` / `args`; accept it but treat it the same as `:q` (no dirty-state checks yet).
   - `wq`: call the existing `write` handler, then call the new `quit` handler.

6. **TypeScript: Wire `save-file` event in `index.ts`**  
   Listen on `vimMode` for `"save-file"` events:
   - `const path = event.filename || getCurrentPath()`
   - If no path, call `setStatusText("No file name")` and return.
   - If `event.filename` is present, call `setCurrentPath(event.filename)`.
   - Call `saveFile(path)`. On success call `setStatusText('"' + path + '" written')`. On error call `setStatusText(error.message)`.

7. **Regenerate N-API declarations**  
   Run `just build` so `lib/index.d.ts` is updated.

## Tasks

### Task 1 - Rust: Track current file path and add save_file N-API

#### Acceptance Criteria

- `TuiState::new()` initializes `current_path` to `None`
- `load_file("/tmp/test.txt")` followed by `get_current_path()` returns `"/tmp/test.txt"`
- `set_current_path("/tmp/other.txt")` updates the stored path
- `save_file` writes all buffer lines joined by `\n` with a trailing newline
- `save_file` to a non-writable path returns an error via NAPI exception and does not modify the editor buffer

#### Non-Automatable
None

### Task 2 - TypeScript: Add quit and wq ex commands, wire save-file event

#### Acceptance Criteria

- `:q` calls `EditorAdapter.commands.quit` and exits the program with code 0
- `:q!` is parsed as `quit` with `argString === "!"` and also exits with code 0
- `:wq` with known path writes file and exits with code 0
- `:wq /tmp/file.txt` writes to path and exits with code 0
- `:w` with no known current path shows `No file name` in the status bar
- `:w /tmp/file.txt` writes buffer content to `/tmp/file.txt`, stores it as current path, and shows a confirmation in the status bar
- `:w!` is parsed as `write` with `args[0] === "!"` and behaves identically to `:w`

#### Non-Automatable
None

### Task 3 - E2E tests for write and quit commands

#### Acceptance Criteria

- `app/tests/e2e/ex-write-quit.test.ts` exists and passes with `just test-e2e`
- `:q<Enter>` causes the terminal program to exit with code 0
- Open editor with a temp file, modify the first line, run `:w<Enter>` → the temp file on disk reflects the modification
- Open editor, run `:w /tmp/revim-e2e-write-<uuid><Enter>` → the specified file is created with the current buffer content
- Open editor with a temp file, modify the first line, run `:wq<Enter>` → the temp file reflects the modification and the program exits with code 0
- Status bar shows `No file name` when `:w` is executed while `current_path` is unset

#### Non-Automatable
None

## Technical Context

- No new runtime dependencies are required.
- NAPI-RS 3.8.3 and `napi-derive` 3.5.2 are already locked in `lib/Cargo.toml`.
- `setStatusText` is an existing N-API function that updates the bottom status bar immediately.
- `TerminalStatusBar.showNotification` is currently a no-op for MVP, so `setStatusText` must be used directly for user-visible ex-command feedback.
- The existing `write` and `save` handlers in `ex-commands.ts` already delegate to `EditorAdapter.commands.save`, which `VimMode` wires to dispatch a `"save-file"` event.

## Notes

- The ex-command dispatcher's `matchCommand_` algorithm requires the input command name to be a prefix of the registered `command.name`. Therefore `wq` must be registered with `name: "wq"` (not `name: "writequit"`) so that `:wq` resolves correctly.
- `showConfirm` dispatches `status-notify`, which `TerminalStatusBar` ignores in the current MVP. Do not rely on `showConfirm` for user-visible `:w`/`:q` feedback.
- After an ex command handler calls `setStatusText`, the text remains visible until the user presses their next key, at which point `TerminalStatusBar.setKeyBuffer` will overwrite it with the mode label. This is acceptable transient-message behavior.
- The `save-file` event listener in `index.ts` should be registered before `vimMode.enable()` so that the event handler is ready when the first command is executed.
- When `:w!` is typed, `argString` is `"!"` and the `save-file` event carries `filename = "!"`. The listener in `index.ts` must treat `filename === "!"` the same as an empty filename (fall back to `getCurrentPath()`), so that `:w!` behaves identically to `:w` as required by the acceptance criteria.
