# Learnings

## Extracting types that reference EditorAdapter requires an interface, not a structural alias
**Date**: 2026-05-08
**Area**: architecture
**What happened**: Extracting `BindingFunction`, `CallFunction`, `Binding`, and `KeyMapEntry` from `adapter.ts` failed when using a structural `Adapter` interface — TypeScript's `strictFunctionTypes` contravariance means functions typed with the concrete `EditorAdapter` aren't assignable to functions expecting the wider structural type. The fix was to introduce a proper `IEditorAdapter` interface, have `EditorAdapter implements IEditorAdapter`, and type all callbacks against `IEditorAdapter`. This also enabled moving the entire vim logic into a separate package (`@revim/vim`) with no dependency on the Rust bindings.
**Takeaway**: When extracting callback-heavy types that reference a concrete class, introduce a named interface (`IEditorAdapter`) rather than a structural alias. Contravariance blocks the structural approach under `strictFunctionTypes`, but an explicit `implements` relationship makes the concrete class assignable everywhere the interface is expected.

---

## tui-test getByText only accepts string and RegExp (not functions), requires `g` flag on regex
**Date**: 2026-05-03
**Area**: testing
**What happened**: E2E test failures traced to passing function predicates to `terminal.getByText(fn)`. tui-test internally uses `String.prototype.includes` for string args and `String.prototype.matchAll` for RegExp args. Functions are `.toString()`'d, producing non-matching source code. Additionally, regex patterns must have the `g` (global) flag or `matchAll` throws a TypeError.
**Takeaway**: Always use `terminal.getByText("exact string")` or `terminal.getByText(/pattern/g)` — never pass a function. If a short string like `":"` matches too many elements on screen (strict mode violation), type additional characters and check a longer combined string like `getByText(":a")`.

---

## Terminal cursor position requires explicit set
**Date**: 2026-03-28
**Area**: testing
**What happened**: E2E tests using `terminal.getCursor()` failed because the app only rendered the cursor using reversed style but didn't call `set_cursor_position()`.
**Takeaway**: When testing cursor position with TUI Test, ensure the app sets the terminal cursor position using `f.set_cursor_position((x, y))` in ratatui.

---

## Silent adapter no-ops are expensive to catch late
**Date**: 2026-03-28
**Area**: architecture
**What happened**: Adapter/backend methods returned success while doing nothing. Local happy-path tests still passed, and gaps only surfaced during review.
**Takeaway**: For TUI adapter methods, prefer a real implementation or an explicit unsupported error. Silent success hides gaps.

---

## Large migrations need behavior-first E2E tests
**Date**: 2026-03-28
**Area**: testing
**What happened**: The Vim migration could typecheck while still breaking core behavior. The fastest progress came from focused E2E probes for concrete user flows.
**Takeaway**: For large editor/input migrations, add small behavior-first E2E tests early. Don't rely on TypeScript/build success as a proxy for working input semantics.

---

## TUI Test requires delays after key presses
**Date**: 2026-03-28
**Area**: testing
**What happened**: Key press events weren't processed immediately, causing cursor assertions to fail. Tests needed `setTimeout` after key presses.
**Takeaway**: Add delays after key presses in TUI Test. Use constants like `RENDER_DELAY_MS = 100` for maintainability.

---

## Rust delta-based undo had complex position tracking issues
**Date**: 2026-03-29
**Area**: rust
**What happened**: Implementing undo/redo in Rust using delta-based history failed because insert mode typed each character as a separate entry with conflicting positions on undo.
**Takeaway**: For undo in this TUI, prefer snapshot-based approach in TypeScript over delta-based in Rust.

---

## False-confidence tests pass when functionality is broken
**Date**: 2026-04-13
**Area**: testing
**What happened**: `expect(after.y).toBeLessThanOrEqual(atLast.y)` passes even when wrapping is non-functional because equal values satisfy the assertion.
**Takeaway**: Test assertions must directly verify the claimed behavior. If wrapping should go to 0, assert exactly 0. A test that passes regardless of whether a feature works is worse than no test.

---

## Rust unit tests race on shared global state
**Date**: 2026-04-14
**Area**: rust/testing
**What happened**: Logging module used a `static Mutex<Option<...>>` and three unit tests interfered when run in parallel.
**Takeaway**: When writing Rust unit tests that access shared statics, use `#[serial]` attribute or `--test-threads=1`.

---

## Terminal Vim input needs one encoding boundary
**Date**: 2026-03-28
**Area**: input
**What happened**: Key handling spread across Rust listener, `index.ts`, and Vim internals caused repeated bugs. Centralizing in `terminal-key.ts` simplified fixes.
**Takeaway**: Keep terminal event normalization in a single module. Avoid reintroducing key-shaping logic in `index.ts` or mode-specific ad hoc handling.

---

## TUI Test Ctrl+Key requires options object
**Date**: 2026-03-29
**Area**: testing
**What happened**: `pressKeys(terminal, ["r"])` just types 'r'. Ctrl combos need `terminal.keyPress("r", { ctrl: true })`.
**Takeaway**: Use `terminal.keyPress(key, { ctrl: true })` for Ctrl key combinations. Check existing tests for patterns.

---

## Imported Vim surface exceeds current TUI semantics
**Date**: 2026-03-28
**Area**: architecture
**What happened**: Porting `vim-monaco` was faster than building from scratch but exposed gaps where the TUI backend doesn't match Monaco-style editor capabilities.
**Takeaway**: Either narrow the advertised Vim surface to what the TUI supports or track follow-up tasks for missing semantics immediately.

---

## Viewport scrolling changes cursor position interpretation
**Date**: 2026-04-13
**Area**: testing
**What happened**: `getCursor()` returns viewport position (0-26), not buffer position. After scrolling, these differ.
**Takeaway**: When writing cursor tests with scrolling, account for viewport offset. Cursor is at `cursor_row - scroll_top` within the viewport.

---

## ManuallyDrop with file descriptors requires into_raw_fd
**Date**: 2026-04-14
**Area**: rust
**What happened**: `ManuallyDrop::into_inner(file).as_raw_fd()` causes double-close. The temporary File drops at `;`, closing the fd, then `libc::close` closes it again.
**Takeaway**: Use `into_raw_fd()` (consuming without Drop) rather than `as_raw_fd()` (borrows, value still drops).

---

## Parametrized key-sequence E2Es work well for terminal editors
**Date**: 2026-03-28
**Area**: testing
**What happened**: Testing multiple Vim flows that differ by key sequence and expected buffer text. A shared `pressKeys()` helper plus case table kept tests readable.
**Takeaway**: Use parametrized test cases with a shared key-press helper for Vim E2E coverage.

---

## N-API error tests: assert Err when uninitialized
**Date**: 2026-03-30
**Area**: rust/napi
**What happened**: Adding unit tests asserting exported functions return `Err` when `TUI_CONTEXT` is `None` caught accidental reintroduction of panics.
**Takeaway**: When modifying N-API boundary code, add tests asserting `Err` when context is uninitialized. Catches `unwrap()` regressions.

---

## Unified key dispatch avoids repeated review cycles
**Date**: 2026-04-14
**Area**: testing
**What happened**: When creating a `Keys` utility with key dispatch methods, having separate if/else chains for `keyPress` and `pressKey` caused gaps (missing `<Enter>`/`<Space>` in one but not the other). Code reviewer caught this twice across multiple review cycles.
**Takeaway**: When creating shared utility functions with similar key-dispatch logic, extract a single dispatch function from the start rather than duplicating the if/else chains. Use a map or shared helper to ensure all aliases are handled consistently in one place.

---

## TUI Test cache corruption causes ENOENT errors
**Date**: 2026-04-14
**Area**: testing
**What happened**: Running multiple test files in parallel caused ENOENT errors when tui-test tried to copy files to its cache (`.tui-test/cache/`).
**Takeaway**: If you see ENOENT errors related to incremental Rust build scripts during E2E test runs, the cache may be corrupted. Running tests with `workers: 1` or sequentially can help. This is a known tui-test issue with aggressive parallelization.

---

## adapter.dispatch (status-display/status-notify) may fail from within doReplace
**Date**: 2026-05-08
**Area**: testing
**What happened**: Calling `adapter.openNotification` or `showConfirm` from inside `doReplace` (specifically from `stop()` called via `replaceAll()`) did not produce visible notifications in E2E tests, despite working from the caller after `doReplace` returned. The root cause was never identified, but the fix was to return data from `doReplace` and call `showConfirm` from the substitute handler.
**Takeaway**: When dispatching status bar events from deep callbacks inside complex ex-command flows (especially inside `doReplace`), prefer returning the result data and dispatching from the calling handler. This avoids an apparent dispatch issue within the nested closure tree.

---

## Testable utilities must go in side-effect-free modules
**Date**: 2026-05-04
**Area**: testing
**What happened**: `createErrorWindow` was initially placed in `index.ts` (which has top-level side effects like `initTui()`). Unit tests importing it crashed because `index.ts` tried to initialize the terminal outside the TUI test environment.
**Takeaway**: Any function that needs unit testing must live in a dedicated module with no top-level side effects. Do not put testable utilities in `index.ts` or any module that calls `initTui`, `startKeyboardListener`, or other terminal APIs at import time. Create a separate `*.ts` file even for small utilities.
---

## Ex commands must be registered in `defaultExCommandMap`
**Date**: 2026-05-08
**Area**: workflow
**What happened**: Adding `bnext`/`bprev` to `exCommands` was insufficient — `:bnext` and `:bprev` silently failed because they weren't registered in `defaultExCommandMap` in `ex-command-dispatcher.ts`. The command map is built at construction time from this array.
**Takeaway**: All new ex commands need entries in both `exCommands` (behavior) and `defaultExCommandMap` (registration). The shortName field controls prefix matching (e.g. `"bn"` for `"bnext"`).

---

## Native NAPI calls from action/ex-command handlers need try/catch
**Date**: 2026-05-08
**Area**: architecture
**What happened**: Code-reviewer flagged multiple call sites where `#[napi]` Rust functions (which return `Result` and throw on failure) were called from TypeScript without error handling. Adding try/catch around every NAPI call site or extracting shared helpers (`doNextBuffer`/`doPrevBuffer`) was required.
**Takeaway**: Every `#[napi]` function can throw. Wrap direct calls in try/catch or route through a shared helper that handles errors. The code-reviewer treats missing error handling as a score-4+ issue.

---

## TuiState active field should be private to prevent bypassing switch_to()
**Date**: 2026-05-08
**Area**: rust
**What happened**: `TuiState::active` was `pub`, allowing direct mutation that bypasses `switch_to()`'s visual-mode reset and selection sync. The code-reviewer flagged this as a correctness risk.
**Takeaway**: State mutation that must enforce invariants (resetting visual mode, clearing highlights, syncing selections) should be behind methods, not public fields. Use `pub(crate)` or private with a getter like `active_index()`.
