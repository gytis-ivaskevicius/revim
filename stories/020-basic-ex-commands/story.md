# Basic ex commands: :w and :q

## Context

The editor currently supports Vim motions, search, and a subset of ex commands, but lacks the fundamental file operations `:w` (write) and `:q` (quit). Without these, users cannot save changes or exit the editor from within the editing session. Adding `:w`, `:q`, and `:wq` enables the most basic editing workflow.

## Out of Scope

- Dirty state tracking / unsaved-changes warnings on quit
- `:w !` (pipe to shell / sudo write)
- File format conversions, encoding changes, or backup files
- Full `showNotification` implementation in `TerminalStatusBar` — visible messages are delivered via `setStatusText` directly

## Implementation approach

1. **Rust: Track current file path in `TuiState`**  
   Add `current_path: Option<String>` to `TuiState` in `lib/src/tui/state.rs`. Initialize to `None`. Update `load_file` in `lib/src/tui/api.rs` to store the loaded path in `current_path`.

2. **Rust: Add N-API surface for path and save**  
   In `lib/src/tui/api.rs`, add three `#[napi]` functions:
   - `get_current_path() -> Result<Option<String>>` — returns the stored path.
   - `set_current_path(path: String) -> Result<()>` — stores the path.
   - `save_file(path: String) -> Result<()>` — acquires the state lock, clones `demo_text`, drops the lock, then writes the lines to disk joined by `\n` with a trailing newline. On I/O error, returns `Err(to_napi_error(err))`. Do not hold locks during file I/O and do not overwrite the editor buffer with an error message.

3. **TypeScript: Expose shutdown without circular imports**  
   In `app/src/index.ts`, import `EditorAdapter` from `./vim` and, after defining `shutdown`, register `EditorAdapter.commands.quit = () => shutdown(0)`. The existing `EditorAdapter.commands` pattern is already used for `open`/`save` event dispatch in `VimMode`, so this keeps `ex-commands.ts` decoupled from `index.ts`.

4. **TypeScript: Register new ex commands**  
   In `app/src/vim/ex-command-dispatcher.ts`, add to `defaultExCommandMap`:
   - `{ name: "quit", shortName: "q" }`
   - `{ name: "wq", shortName: "wq" }`

5. **TypeScript: Implement handlers in `ex-commands.ts`**  
   Import `getCurrentPath`, `setCurrentPath`, `saveFile`, `setStatusText` from `@revim/lib`.  
   Add/replace handlers in `exCommands`:
   - **`quit`** — call `EditorAdapter.commands.quit?.()`. The `!` suffix is parsed as `argString` starting with `!`; accept it but treat it the same as `:q` (no dirty-state checks yet).
   - **`write`** — replace the existing no-op delegation. Parse force flag: `const force = params.args?.[0] === "!"`. Resolve target path: if a non-`!` arg exists, use it and call `setCurrentPath(path)`. Otherwise call `getCurrentPath()`. If no path is returned, call `setStatusText("No file name")` and return. Otherwise call `saveFile(path)`. On success, call `setStatusText('"' + path + '" written')`. On error (catch block), call `setStatusText(error.message)`.
   - **`wq`** — execute the same path-resolution and save logic as `write`, then call `quit`.

6. **Regenerate N-API declarations**  
   Run `just build` so that `lib/index.d.ts` is regenerated with the new functions.

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

### Task 2 - TypeScript: Add quit, write, and wq ex command handlers

#### Acceptance Criteria

- `:q` calls `EditorAdapter.commands.quit` and exits the program with code 0
- `:q!` is parsed as `quit` with a force flag and also exits with code 0
- `:w` with no known current path shows `No file name` in the status bar
- `:w /tmp/file.txt` writes buffer content to `/tmp/file.txt`, stores it as current path, and shows a confirmation in the status bar
- `:wq` with known path writes file and exits with code 0
- `:wq /tmp/file.txt` writes to path and exits with code 0
- `:w!` is parsed as `write` with force flag and behaves identically to `:w`

#### Non-Automatable
None

### Task 3 - E2E tests for write and quit commands

#### Acceptance Criteria

- `app/tests/e2e/ex-write-quit.test.ts` exists and passes with `just test-e2e`
- `:q<Enter>` causes the terminal program to exit with code 0
- Open editor with a temp file, modify the first line, run `:w<Enter>` → the temp file on disk reflects the modification
- Open editor, run `:w /tmp/revim-e2e-write-<uuid><Enter>` → the specified file is created with the current buffer content
- Open editor with a temp file, modify the first line, run `:wq<Enter>` → the temp file reflects the modification and the program exits with code 0
- Status bar shows `No file name` when `:w` is executed while `current_path` is unset (verified by unit test or E2E)

#### Non-Automatable
None

## Technical Context

- No new runtime dependencies are required.
- NAPI-RS 3.8.3 and `napi-derive` 3.5.2 are already locked in `lib/Cargo.toml`.
- `setStatusText` is an existing N-API function that updates the bottom status bar immediately.
- `TerminalStatusBar.showNotification` is currently a no-op for MVP, so `setStatusText` must be used directly for user-visible ex-command feedback.

## Notes

- The ex-command dispatcher's `matchCommand_` algorithm requires the input command name to be a prefix of the registered `command.name`. Therefore `wq` must be registered with `name: "wq"` (not `name: "writequit"`) so that `:wq` resolves correctly.
- `showConfirm` dispatches `status-notify`, which `TerminalStatusBar` ignores in the current MVP. Do not rely on `showConfirm` for user-visible `:w`/`:q` feedback.
- After an ex command handler calls `setStatusText`, the text remains visible until the user presses their next key, at which point `TerminalStatusBar.setKeyBuffer` will overwrite it with the mode label. This is acceptable transient-message behavior.
