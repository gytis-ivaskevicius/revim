# CLI File Opening

## Context

Currently revim always opens with a hardcoded demo buffer defined in Rust (`lib/src/tui/state.rs`). Users cannot open their own files from the command line. This story adds `revim <filepath>` support, moves the demo content to a fixture file, and makes the fixture the default when no path is provided.

## Out of Scope

- File saving (`:w`) or creating missing files on disk
- Multiple file buffers / tabs
- File change detection or read-only guards
- Directory browsing
- Syntax highlighting per file type

## Implementation approach

### 1. Extract demo content to a fixture file

Move every line from the `demo_text` vector in `TuiState::new()` (`lib/src/tui/state.rs`) into a new file `app/tests/fixtures/demo-content.md`. Preserve empty lines exactly as they appear in the Rust vector (they correspond to blank lines in the markdown file). Do not add a trailing newline after the last line (Rust `load_file` pops trailing empty elements).

### 2. Empty Rust default buffer

Change `TuiState::new()` to initialize `demo_text` with `vec![String::new()]` (a single empty line) instead of the hardcoded vector. This removes the last Rust-side default content. The `Default` implementation delegates to `new()`, so it also becomes empty. All Rust unit tests in `state.rs` use `create_state_with_text` or explicitly override `demo_text`, so they are unaffected.

### 3. Add `loadFile` N-API function in Rust

In `lib/src/tui/api.rs`, add a new `#[napi]` function `load_file(path: String) -> Result<()>`:
- Acquire the `TUI_CONTEXT` lock and the inner `state` lock.
- Call `std::fs::read_to_string(&path)`.
- On success, split the string on `\n`. If the last element is empty (trailing newline), pop it.
- Call a new `state.set_lines(lines)` method to replace `demo_text`.
- Drop all locks before calling `render_frame_internal()`.
- Return `Ok(())`.
- On error (file not found, permission denied, etc.):
  - Call `state.set_lines(vec![format!("Error opening '{}': {}", path, err)])` so the error is visible to the user in the buffer.
  - Drop locks, call `render_frame_internal()`, and return `Ok(())` (error is shown in-buffer, no exception).

In `lib/src/tui/state.rs`, add `pub fn set_lines(&mut self, lines: Vec<String>)`:
- Replace `self.demo_text` with the provided lines.
- Reset `cursor_row`, `cursor_col`, `anchor_row`, `anchor_col`, and `scroll_top` to `0`.
- Call `self.sync_primary_selection()`.

### 4. CLI arg parsing and calling `loadFile` in `index.ts`

Add a `parseFilePath` helper to `app/src/index.ts`:

**`parseFilePath(args: string[]): string | undefined`**
- Start scanning from index `1` (skip the runtime binary).
- Skip `--log` and its immediately following value.
- Skip the literal arg `"run"` (from `bun run ...`).
- Skip any arg ending in `index.ts` (the script path).
- Return the first remaining arg, or `undefined` if none.

In `main()`, after `initTui()` and before `startKeyboardListener()`:
1. Resolve the target path:
   - If `parseFilePath(process.argv)` returns a value, use it directly.
   - Otherwise default to `path.join(import.meta.dir, "../tests/fixtures/demo-content.md")`.
2. Call `loadFile(targetPath)` from `@revim/lib`.
3. `loadFile` never throws — errors are rendered in-buffer as the first line. For a missing default fixture, the error line is shown immediately and is visible to the developer on launch.

### 5. Test utilities

In `app/tests/e2e/test-utils.ts`, add:

```ts
export function withFile(filePath: string) {
  return { program: { file: "bun", args: ["run", "app/src/index.ts", filePath] } }
}
```

### 6. E2E regression and feature tests

Create `app/tests/e2e/cli-file-open.test.ts` with:
- A test that uses the default config (no file arg) and asserts `"Welcome to ReVim!"` is visible.
- A test that uses `withFile(...)` pointing at a temporary fixture and asserts the fixture's first line is visible.
- A test that uses `withLog` combined with `withFile` (or a merged config) to verify `--log` and a filepath work together.

All pre-existing E2E tests must continue to pass without modification because the default no-arg behavior still loads the same demo content.

## Tasks

### Task 1 — Move demo content to fixture and empty Rust default

#### Acceptance Criteria

- [ ] `app/tests/fixtures/demo-content.md` exists and contains the same lines (including blanks) as the old hardcoded `demo_text` vector in `state.rs`
- [ ] `TuiState::new()` initializes `demo_text` to `vec![String::new()]`
- [ ] The hardcoded `demo_text` vector is fully removed from `state.rs`
- [ ] `just test-rust` passes

#### Non-Automatable

- Visual inspection that the initial render no longer flashes hardcoded content before TypeScript loads

### Task 2 — Add `loadFile` N-API function and wire CLI loading in `index.ts`

#### Acceptance Criteria

- [ ] `lib/src/tui/api.rs` contains `#[napi] pub fn load_file(path: String) -> Result<()>`
- [ ] `load_file` reads the file with `std::fs::read_to_string`, splits on `\n`, pops trailing empty element, and calls `state.set_lines(lines)`
- [ ] `load_file` drops all mutex locks before calling `render_frame_internal()`
- [ ] `load_file` on error sets content to a formatted error line (e.g. `"Error opening '{path}': {err}"`) and returns `Ok(())`
- [ ] `lib/src/tui/state.rs` contains `pub fn set_lines(&mut self, lines: Vec<String>)` that replaces `demo_text`, resets cursor/anchor/scroll to `0`, and calls `sync_primary_selection()`
- [ ] `parseFilePath(["bun", "run", "app/src/index.ts", "--log", "/tmp/log", "myfile.txt"])` returns `"myfile.txt"`
- [ ] `parseFilePath(["bun", "run", "app/src/index.ts"])` returns `undefined`
- [ ] `parseFilePath(["bun", "src/index.ts", "other.md"])` returns `"other.md"`
- [ ] When `parseFilePath` returns `undefined`, `main()` loads `../tests/fixtures/demo-content.md` relative to `import.meta.dir`
- [ ] When `parseFilePath` returns a path, `main()` loads that path
- [ ] `loadFile` is called after `initTui()` and before `startKeyboardListener()`
- [ ] `import { loadFile } from "@revim/lib"` is added to `index.ts`
- [ ] `import path from "node:path"` is added to `index.ts`

#### Non-Automatable

- Manual smoke test: `just dev` opens demo content
- Manual smoke test: `just dev -- /tmp/test.txt` opens the specified file

### Task 3 — Add E2E coverage and verify existing tests

#### Acceptance Criteria

- [ ] `withFile(filePath)` helper exists in `test-utils.ts`
- [ ] E2E test: default launch (no file arg) shows `"Welcome to ReVim!"`
- [ ] E2E test: explicit file arg shows the file's first line
- [ ] E2E test: `--log` combined with a file arg works (both flags and file are honored)
- [ ] All pre-existing E2E tests still pass without modification
- [ ] `just test-e2e` passes

#### Non-Automatable

- Snapshot tests may need regeneration if the exact render timing changes; this is a one-time `just test-e2e -u` update if needed

## Technical Context

- No new npm or cargo dependencies are required.
- `std::fs::read_to_string` is used on the Rust side to read the file; `node:path` is used on the TypeScript side only for cross-platform path joining to locate the default fixture.
- `loadFile` is a new NAPI-RS function added to `lib/src/tui/api.rs` and exported via the auto-generated `lib/index.d.ts` bindings.
- `import.meta.dir` is a Bun-specific meta-property that resolves to the directory containing the current module; it is the most robust way to locate the fixture file regardless of the process working directory.

## Notes

- The existing `--log` parsing in `index.ts` must remain and must not conflict with filepath parsing.
- Because `initTui()` calls `render_frame_internal()` before TypeScript runs, the very first frame will show a single empty line. `loadFile()` then immediately re-renders with the actual content, so the blank flash is imperceptible in practice.
- If the default fixture file is missing, the error is rendered in-buffer so the failure is immediately visible during development or CI.
