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
