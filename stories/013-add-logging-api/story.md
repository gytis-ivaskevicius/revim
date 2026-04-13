# Add Logging API

## Context

The terminal TUI takes over stdout (alternate screen), so `console.log` and `console.error` produce invisible or garbled output. There is currently no way to record diagnostic information during a live session or a test run — which makes debugging complex Vim-mode and render issues painful, especially for LLM agents working through E2E failures.

This feature adds a file-based logging API usable from both Rust and TypeScript. Pass `--log /path/to/some.log` to the app (or to the `just dev` recipe) and all log calls across both sides of the FFI boundary are written to that file. Tests can opt-in to a log file via a one-liner helper in `test-utils.ts`; after a failure, the log gives a full timeline of key events and state changes.

## Out of Scope

- Log levels (DEBUG/INFO/WARN/ERROR) — plain messages are sufficient for now
- Log rotation or size limiting
- Structured (JSON) log format
- Logging from the keyboard-listener Rust thread (that code path runs on a separate thread; adding thread-safe logging there is a follow-up)
- Removing or replacing `console.error` calls in existing error paths

## Implementation approach

### Log format

Every line in the log file follows exactly this format:

```
[<ISO-8601 timestamp>] [<source>] <message>\n
```

- `<source>` is `TS` for app TypeScript entries, `RS` for Rust entries.
- `<message>` is a single line (newlines inside the message are replaced with `\n`).
- Timestamp is `new Date().toISOString()` on the TS side and `chrono`-free on the Rust side: derive from `std::time::SystemTime` via `duration_since(UNIX_EPOCH)` formatted as `YYYY-MM-DDTHH:MM:SS.mmmZ`.

Example of what a test failure log looks like:
```
[2026-04-13T10:00:00.123Z] [TS] revim starting
[2026-04-13T10:00:00.131Z] [RS] init_tui: TUI initialized
[2026-04-13T10:00:00.200Z] [TS] key: j
[2026-04-13T10:00:00.201Z] [RS] render_frame_internal: rendered
[2026-04-13T10:00:00.250Z] [TS] key: d
[2026-04-13T10:00:00.251Z] [TS] vim mode: operator pending
[2026-04-13T10:00:00.300Z] [TS] key: w
[2026-04-13T10:00:00.301Z] [TS] vim mode: normal
[2026-04-13T10:00:00.301Z] [RS] render_frame_internal: rendered
[2026-04-13T10:00:00.400Z] [TS] revim shutdown
```

### Single file descriptor — no dual-appender problem

TypeScript opens the file (truncates it) and passes the raw fd to Rust. There is exactly one open file description in the process; both sides write to it via the same OS fd.

### TypeScript module — `app/src/log.ts`

```typescript
import { openSync, writeSync } from "node:fs"

let logFd: number | null = null

export function initLog(path: string): void  // truncates/creates the file, stores fd, calls setLogFd(fd)
export function log(...args: unknown[]): void  // no-op if initLog was never called
```

`initLog` opens the file with `openSync(path, "w")` (creates or **truncates**), stores the fd, then immediately calls `setLogFd(fd)` (the Rust NAPI function) to hand the same fd to Rust. `log` formats `[timestamp] [TS] message\n` and calls `writeSync(logFd, line)` — synchronous so entries survive a crash.

### Rust module — `lib/src/tui/log.rs`

```rust
static LOG_FILE: Mutex<Option<ManuallyDrop<File>>> = Mutex::new(None);

#[napi] pub fn set_log_fd(fd: i32) -> Result<()>  // wraps the TS-owned fd, does NOT close it
pub(crate) fn append_log(msg: &str)               // no-op if not initialized
```

`set_log_fd` wraps the integer with `unsafe { ManuallyDrop::new(File::from_raw_fd(fd as RawFd)) }`. `ManuallyDrop` prevents Rust from calling `File::drop` (which would close the fd) — TS owns the fd's lifetime. `append_log` formats `[timestamp] [RS] msg\n`, acquires the mutex, and calls `write_all` on the `File`. If the lock is poisoned or fd is not set, it is silently skipped — never panics.

A convenience macro for internal Rust use:
```rust
macro_rules! revim_log {
    ($($arg:tt)*) => { append_log(&format!($($arg)*)) };
}
```

All NAPI calls (including those triggered from `init_tui`, `render_frame_internal`, etc.) execute on Node's main thread, so there is no concurrent write between TS and Rust.

### Wiring in `index.ts`

Parse `--log <path>` from `process.argv` (first occurrence of `--log` followed by a non-flag value). Then, before `initTui()`:

```typescript
if (logPath) {
  initLog(logPath)        // TS opens and truncates the file; hands fd to Rust via setLogFd
  log("revim starting")
}
initTui()                 // Rust emits: "init_tui: TUI initialized"
```

On `cleanup()`, call `log("revim shutdown")` so the end of a session is always marked.

### Strategic log points

These are the entries that make a log useful for debugging a test failure. They must all be added as part of this story:

| Location | What to log |
|---|---|
| `index.ts` `processKeyEvent` | `key: <encodedKey>` — every key the app receives |
| `app/src/vim/keymap_vim.ts` vim mode change handler | `vim mode: <mode>` — whenever the vim mode transitions (normal / insert / visual / operator-pending / replace) |
| `lib/src/tui/api.rs` `init_tui` | `init_tui: TUI initialized` |
| `lib/src/tui/api.rs` `shutdown_tui` | `shutdown_tui: TUI shut down` |
| `lib/src/tui/render.rs` `render_frame_internal` | `render_frame_internal: rendered` |

### Test helper in `test-utils.ts`

`withLog` returns a config object that overrides the spawned program's args so the app process writes its log to the given path. The test itself does not write to the log.

```typescript
export function withLog(logPath: string) {
  return { program: { file: "bun", args: ["run", "app/src/index.ts", "--log", logPath] } }
}
```

Usage:
```typescript
const LOG = "/tmp/revim-debug.log"
test.use(withLog(LOG))

test("something", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()
  // on failure, inspect /tmp/revim-debug.log
})
```

### Justfile

Change the `dev` recipe to accept and forward extra arguments so `just dev --log /tmp/foo.log` works:

```just
dev *args: build
    cd app && bun run src/index.ts {{args}}
```

(Removes the indirection through `bun run dev` script; args are forwarded verbatim to the Bun entrypoint.)

## Tasks

### Task 1 — Rust logging module

Add `lib/src/tui/log.rs`:
- `static LOG_FILE: Mutex<Option<ManuallyDrop<File>>>`
- `#[napi] fn set_log_fd(fd: i32) -> Result<()>` — wraps fd in `ManuallyDrop<File>`, does not truncate or close
- `pub(crate) fn append_log(msg: &str)` — formats `[timestamp] [RS] msg\n`, acquires lock, `write_all`; silent no-op on any error
- `revim_log!(...)` macro — delegates to `append_log(&format!(...))`

Register in `lib/src/tui/mod.rs`: `mod log; pub(crate) use log::{append_log, revim_log};` and ensure `set_log_fd` is re-exported via `pub use api::*`.

Add `revim_log!` calls:
- `init_tui()`: `revim_log!("init_tui: TUI initialized")`
- `shutdown_tui()`: `revim_log!("shutdown_tui: TUI shut down")`
- `render_frame_internal`: `revim_log!("render_frame_internal: rendered")`

#### Acceptance Criteria

- `set_log_fd` called with a valid writable fd + `append_log("hello")` invoked
  - → fd receives a line matching `^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\] \[RS\] hello\n$`
- `append_log("hello")` called without prior `set_log_fd`
  - → no panic, no file written
- `set_log_fd` called with an invalid fd (e.g., `-1`)
  - → subsequent `append_log` silently does nothing, no panic

Implement these ACs as `#[cfg(test)]` Rust unit tests inside `log.rs` using a temp file opened with `OpenOptions`.

### Task 2 — TypeScript logging module and wiring

Add `app/src/log.ts` with `initLog(path)` and `log(...args)`. Wire into `index.ts`:
1. Parse `--log <path>` from `process.argv`.
2. If present: call `initLog(path)` (which internally calls `setLogFd`), then `log("revim starting")`.
3. On `cleanup()`: call `log("revim shutdown")`.

`setLogFd` is imported from `@revim/lib` (available after Task 1 is built).

Add strategic TS log calls:
- `index.ts` `processKeyEvent`: `log(\`key: ${encodedKey}\`)`
- `app/src/vim/keymap_vim.ts` vim mode change: `log(\`vim mode: ${newMode}\`)` — add this wherever the vim adapter fires a mode-change event (the existing `"vim-mode-change"` event or equivalent in the TS vim layer)

#### Acceptance Criteria

- app started with `--log /tmp/t.log` + app renders "Welcome to ReVim!"
  - → `/tmp/t.log` exists
  - → file contains a line matching `\[TS\] revim starting`
  - → file contains a line matching `\[RS\] init_tui: TUI initialized`
  - → all lines match `^\[.*\] \[(TS|RS)\] .*$`
- app started with `--log /tmp/t.log` + one key pressed (e.g., `j`)
  - → file contains a line matching `\[TS\] key: j`
  - → file contains a line matching `\[RS\] render_frame_internal: rendered`
- app started without `--log` + app renders normally
  - → no crash or error
- pre-existing file at log path + app started with `--log` pointing at that path
  - → old content not present (file was overwritten)

### Task 3 — Developer ergonomics

Update `Justfile` `dev` recipe to accept `*args`. Add `withLog(path)` to `test-utils.ts`. Add `app/tests/e2e/logging.test.ts` that:
1. Uses `test.use(withLog("/tmp/revim-logging-test.log"))`.
2. Waits for `"Welcome to ReVim!"` to be visible.
3. Presses one key (`j`).
4. Reads the log file with `readFileSync`.
5. Asserts `[TS] revim starting`, `[RS] init_tui`, `[TS] key: j`, and `[RS] render_frame_internal` entries are all present.
6. Asserts every non-empty line matches `^\[.*\] \[(TS|RS)\] .*$`.

#### Acceptance Criteria

- `withLog("/tmp/foo.log")` + app renders + key `j` pressed
  - → `/tmp/foo.log` contains `[TS] revim starting`
  - → `/tmp/foo.log` contains `[RS] init_tui`
  - → `/tmp/foo.log` contains `[TS] key: j`
  - → `/tmp/foo.log` contains `[RS] render_frame_internal`
  - → every non-empty line matches `^\[.*\] \[(TS|RS)\] .*$`

#### Non-Automatable

- `just dev --log /tmp/foo.log` manual smoke-test: run, press a few keys including mode changes, Ctrl+C, inspect the log — should see key entries, mode transitions, and render entries interleaved.

## Technical Context

- **napi-derive 3.5.2 / napi 3.8.3** — `#[napi]` on `set_log_fd` follows the same pattern as all other NAPI functions in `api.rs`; no breaking changes.
- **Rust `std::os::unix::io::FromRawFd` + `std::mem::ManuallyDrop`** — both are in `std`; no new crate dependencies. `ManuallyDrop<File>` gives mutable write access via `DerefMut` while preventing `drop` from closing the fd.
- **Rust std::time::SystemTime** — used for timestamps with no extra crate. Pattern: `SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default()` → format seconds + millis manually.
- **Bun 1.3.11** — `openSync`/`writeSync` from `node:fs` fully supported; synchronous writes don't meaningfully block the event loop for a debug logger.
- **@microsoft/tui-test 0.0.3** — `test.use({ program: {...} })` accepts a full program config override per suite; `withLog` returns exactly this shape.
- **biome 2.4.9** — new files in `app/src/` and `app/tests/e2e/` are covered by the existing biome config; no changes needed.

## Notes

- `writeSync` is intentionally synchronous: the primary use-case is crash debugging where async buffering would lose the last entries.
- Rust's `append_log` acquires a `Mutex` on every call. This is acceptable because the keyboard-listener thread (the only other active Rust thread) is explicitly excluded from logging in this story.
- `render_frame_internal` is called on every keypress; its log entry will be noisy but is essential for correlating key events with render cycles during test debugging.
- Tests read the log file with `readFileSync` after `toBeVisible()` and a key press resolve — by that point the app's synchronous writes are on disk.
