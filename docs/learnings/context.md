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

## Imported Vim Surface Exceeds Current TUI Semantics
**Date**: 2026-03-28
**What happened**: Porting `vim-monaco` into the terminal app was faster than building a Vim layer from scratch, but it also exposed gaps where the TUI backend does not yet match Monaco-style editor capabilities, especially around viewport behavior, visual selection rendering, and deferred actions like undo/redo.
**Recommendation**: When extending the port, either narrow the advertised Vim surface to what the TUI truly supports or track follow-up tasks for missing semantics immediately so silent partial behavior does not accumulate.

---
