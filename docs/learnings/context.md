# Context Gaps

## TUI Test imports require .js extension
**Date**: 2026-03-28
**What happened**: TypeScript test files importing from `./test-utils` failed with "Cannot find module" error. The TUI Test framework transpiles TypeScript and requires `.js` extensions for ESM compatibility.
**Recommendation**: Use `.js` extensions in imports: `import { test } from "./test-utils.js"` even for TypeScript files.

---

## Terminal Vim Input Needs One Encoding Boundary
**Date**: 2026-03-28
**What happened**: Key handling was spread across the Rust listener, `app/src/index.ts`, and Vim internals, which caused repeated bugs around quoted literals, uppercase keys, `Esc`, `Shift-Space`, and insert-mode text. The fixes became much simpler once terminal event encoding was centralized in `app/src/terminal-key.ts` and `index.ts` was reduced to forwarding encoded keys.
**Recommendation**: Keep terminal event normalization in a single module and route all key traffic through one Vim entrypoint. Avoid reintroducing key-shaping logic in `app/src/index.ts` or mode-specific ad hoc handling outside the shared encoder.

---

## TUI Test Ctrl+Key Requires Options Object
**Date**: 2026-03-29
**What happened**: When writing E2E tests for redo (`Ctrl+r`), I initially tried `pressKeys(terminal, ["r"])` which just types the letter 'r'. The TUI Test framework requires `{ ctrl: true }` passed as second argument: `terminal.keyPress("r", { ctrl: true })`.
**Recommendation**: Use `terminal.keyPress(key, { ctrl: true })` for Ctrl key combinations in TUI Test. Check existing tests in `app/tests/e2e/` for patterns.

---

## Local commit GPG signing can block quick commits
**Date**: 2026-03-30
**What happened**: Committing changes failed in this session because GPG signing timed out in the environment. This prevented an immediate signed commit and required committing with signing disabled.
**Recommendation**: Document a recommended fallback for local development: if GPG signing fails, either unlock the key agent or run `git -c commit.gpgsign=false commit -m "..."` to bypass signing for the interim. For CI, ensure a non-interactive signing strategy or disable signing on automated runners.

---

## Imported Vim Surface Exceeds Current TUI Semantics
**Date**: 2026-03-28
**What happened**: Porting `vim-monaco` into the terminal app was faster than building a Vim layer from scratch, but it also exposed gaps where the TUI backend does not yet match Monaco-style editor capabilities, especially around viewport behavior, visual selection rendering, and deferred actions like undo/redo.
**Recommendation**: When extending the port, either narrow the advertised Vim surface to what the TUI truly supports or track follow-up tasks for missing semantics immediately so silent partial behavior does not accumulate.

---

## Viewport scrolling changes cursor position interpretation
**Date**: 2026-04-13
**What happened**: Tests checking `terminal.getCursor()` after many key presses failed because `getCursor()` returns the VIEWPORT position (0-26 for a 27-row viewport), not the buffer position. After scrolling, the viewport position differs from the buffer cursor position. Old tests designed for a 7-line buffer that fits entirely in the viewport assumed direct buffer position = viewport position.
**Recommendation**: When writing cursor position tests with scrolling, account for the viewport offset. The viewport shows rows `[scroll_top, scroll_top + viewport_height)` and cursor is at `cursor_row - scroll_top` within the viewport. Use scroll tests (`scroll.test.ts`) to verify viewport behavior rather than relying on raw cursor positions after scrolling.

---

## Running only one reviewer delays finding issues
**Date**: 2026-04-13
**What happened**: The workflow requires both acceptance reviewer AND code reviewer to pass. Running only acceptance reviewer and assuming code review would pass later delayed finding real issues. Code reviewer found false-confidence tests, duplicate tests, and missing coverage that acceptance reviewer missed.
**Recommendation**: Always run both `@acceptance-reviewer` and `@code-reviewer` together after each fix. Per AGENTS.md: "A story is complete only when the latest acceptance-review and code-review verdict commits both Pass."

---

## ManuallyDrop with file descriptors requires careful handling
**Date**: 2026-04-14
**What happened**: Using `ManuallyDrop::into_inner(file).as_raw_fd()` to get a raw fd from a ManuallyDrop-wrapped File causes a double-close: `into_inner` returns the File by value (consuming the ManuallyDrop), then `as_raw_fd()` borrows it. The temporary File is dropped at the `;` line ending, closing the fd. Then `libc::close(raw_fd)` closes it again. The fix is using `ManuallyDrop::into_inner(file).into_raw_fd()` which consumes the File without running its Drop.
**Recommendation**: When extracting a raw fd from a ManuallyDrop-wrapped type, use `IntoRawFd::into_raw_fd()` (consuming the value without Drop) rather than `as_raw_fd()` (which borrows and leaves the value to be dropped). Or simply don't close the fd at all if TS owns the lifetime.

---

## Rust Mutex deadlock in NAPI functions that call render_frame_internal
**Date**: 2026-04-14
**What happened**: After pressing `/movement<Enter>` in the vim search prompt, all subsequent keyboard input stopped being processed. The root cause was a deadlock in `set_highlights()`: it acquired `TUI_CONTEXT.lock()` and `state.lock()`, then called `render_frame_internal()` which also tries to acquire `TUI_CONTEXT.lock()`. Since `std::sync::Mutex` is not reentrant, this deadlocked the JS thread, preventing any further NAPI calls from completing. Other functions like `set_cursor_pos` correctly dropped locks with `{ }` blocks before calling `render_frame_internal()`, but `set_highlights` did not.
**Recommendation**: Any Rust NAPI function that acquires `TUI_CONTEXT.lock()` or `state.lock()` must drop those locks BEFORE calling `render_frame_internal()`. Use `{ ... }` blocks to scope the lock. Audit all `render_frame_internal()` call sites for this pattern. When debugging "keyboard stops working" or "NAPI calls hang", check for mutex deadlocks in synchronous NAPI functions before investigating async/callback issues.

---

## Story demo buffer mismatch with actual buffer content
**Date**: 2026-04-14
**What happened**: Story 010 vim-search ACs describe a 7-line demo buffer with "cursor" at lines 3, 4, 6. But `lib/src/tui/state.rs` actually has a 46-line buffer with "cursor" at lines 21, 22, 39. Tests written based on the story's buffer expectations failed until corrected.
**Recommendation**: When writing or fixing tests for search functionality, always verify the actual demo buffer content in `lib/src/tui/state.rs` rather than relying on story documentation. The story buffer description may be outdated or incorrect.

---

## Partial code review fixes waste cycles
**Date**: 2026-04-14
**What happened**: Code reviewer flagged 9 issues. I fixed 3 and re-ran review, but Fail remained because 6 issues were unaddressed. Required additional fix+review cycles.
**Recommendation**: When a code reviewer reports N issues, fix ALL N issues before re-requesting review. Don't cherry-pick which issues to address based on perceived importance - the reviewer is the authority on correctness.

---
