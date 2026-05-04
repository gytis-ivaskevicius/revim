# Acceptance Criteria — CLI File Opening

## Task 1 — Move demo content to fixture and empty Rust default

- [ ] `app/tests/fixtures/demo-content.md` exists with the same lines as the old hardcoded `demo_text`
- [ ] `TuiState::new()` uses `vec![String::new()]` for `demo_text`
- [ ] Hardcoded `demo_text` vector removed from `state.rs`
- [ ] `just test-rust` passes

## Task 2 — Wire CLI file loading in `index.ts`

- [ ] `parseFilePath` skips `--log` and its value
- [ ] `parseFilePath` skips `"run"` and args ending in `index.ts`
- [ ] `parseFilePath` returns the first remaining positional arg
- [ ] `parseFilePath` returns `undefined` when no file arg is present
- [ ] `main()` loads the default fixture when no file arg is given
- [ ] `main()` loads the explicit file when a file arg is given
- [ ] `setAllLines` is imported from `@revim/lib` and called after `initTui()`
- [ ] Read errors for explicit files fallback to `setAllLines([""])` with a log line
- [ ] `node:path` is used to resolve the default fixture relative to `import.meta.dir`

## Task 3 — Add E2E coverage and verify existing tests

- [ ] `withFile(path)` helper added to `test-utils.ts`
- [ ] E2E test: default launch shows `"Welcome to ReVim!"`
- [ ] E2E test: explicit file arg shows the file's content
- [ ] E2E test: `--log` + file arg both work together
- [ ] All pre-existing E2E tests pass without modification
- [ ] `just test-e2e` passes
