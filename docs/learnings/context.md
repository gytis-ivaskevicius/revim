# Context Gaps

## TUI Test imports require .js extension
**Date**: 2026-03-28
**What happened**: TypeScript test files importing from `./test-utils` failed with "Cannot find module" error. The TUI Test framework transpiles TypeScript and requires `.js` extensions for ESM compatibility.
**Recommendation**: Use `.js` extensions in imports: `import { test } from "./test-utils.js"` even for TypeScript files.

---