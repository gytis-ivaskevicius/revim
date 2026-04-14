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

## Redo Already Works - Just Needed Tests
**Date**: 2026-03-29
**When useful**: When functionality seems broken but user says it works. The redo (`Ctrl+r`) implementation was already complete in the TypeScript adapter - I assumed there was a key encoding bug because I couldn't find tests. Always trust user feedback about working features and focus on test coverage.

---

## Parametrized tests for similar behaviors
**Date**: 2026-03-28
**When useful**: When testing similar behaviors like cursor movement in different directions. Use a `for` loop over an array of test cases to reduce code duplication and ensure consistent test structure.

---

## N-API error tests: assert Err when uninitialized
**Date**: 2026-03-30
**When useful**: When modifying N-API boundary code (Rust) — add small unit tests asserting exported functions return `Err` when `TUI_CONTEXT` is `None`. These tests catch accidental reintroduction of panics (`unwrap()`) and confirm `to_napi_error` mapping remains in place.

---

## G/gg commands more reliable than repeated ArrowDown for scroll tests
**Date**: 2026-04-13
**When useful**: When testing scroll behavior that requires navigating to specific lines. Pressing ArrowDown 40+ times is slow and timing-sensitive. Using `G` to jump directly to the last line and `gg` to return is faster and more deterministic. For scroll tests, prefer G/gg navigation over repeated ArrowDown presses.

---

## Comment out NAPI calls to isolate deadlocks
**Date**: 2026-04-14
**When useful**: When keyboard input or NAPI callbacks stop working after a specific operation (like search). Instead of investigating async/callback mechanisms, comment out NAPI functions called during that operation one by one. A mutex deadlock in a synchronous NAPI function will freeze the JS event loop, making it look like callbacks stopped working. The fastest way to find it: disable the NAPI calls made during the problematic operation and see if input resumes.

---

## Search cursor off-by-one breaks 'n' navigation
**Date**: 2026-04-14
**When useful**: When vim search 'n' to find next match doesn't find subsequent matches.
**What happened**: `getSearchCursor.find()` for forward search used `match.ch >= startPos.ch` when starting from a position. This found the SAME match again instead of the NEXT match when cursor was already on a match. Fix: use `>` instead of `>=`.
**Recommendation**: For forward search starting from current position, use `>` not `>=` to find the next match, not the current one.

---
