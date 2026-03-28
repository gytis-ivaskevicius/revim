# Aha Moments

## Shared test configuration reduces duplication
**Date**: 2026-03-28
**When useful**: When writing multiple E2E tests that use the same terminal configuration (program, rows, columns). Create a `test-utils.ts` file that exports `test`, `expect`, and configuration constants.

---

## Parametrized tests for similar behaviors
**Date**: 2026-03-28
**When useful**: When testing similar behaviors like cursor movement in different directions. Use a `for` loop over an array of test cases to reduce code duplication and ensure consistent test structure.

---