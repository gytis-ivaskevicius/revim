# Aha Moments

## Shared test configuration reduces duplication
**Date**: 2026-03-28
**When useful**: When writing multiple E2E tests that use the same terminal configuration (program, rows, columns). Create a `test-utils.ts` file that exports `test`, `expect`, and configuration constants.

---

## Parametrized key-sequence E2Es work well for terminal editors
**Date**: 2026-03-28
**When useful**: When testing multiple Vim editing flows that differ mainly by key sequence and expected buffer text. A shared `pressKeys()` helper plus a small case table keeps terminal E2Es readable while still covering meaningful user behavior.

---

## Key-path cleanup starts by shrinking the app entrypoint
**Date**: 2026-03-28
**When useful**: When input handling starts accumulating special cases. Move normalization into a dedicated module (here `app/src/terminal-key.ts`) so the app entrypoint only forwards encoded keys into the editor layer.

---

## Parametrized tests for similar behaviors
**Date**: 2026-03-28
**When useful**: When testing similar behaviors like cursor movement in different directions. Use a `for` loop over an array of test cases to reduce code duplication and ensure consistent test structure.

---
