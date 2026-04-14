# Improve Testing Infrastructure — DRY Key Passing

## Context

Our E2E test suite has grown to 12 test files covering cursor movement, visual mode, search, undo/redo, scroll, status bar, and more. As the suite expanded, several patterns were copy-pasted rather than centralized:

**Duplicated `pressKeys` function** — `vim-mode.test.ts`, `visual-mode.test.ts`, and `undo-redo.test.ts` each define their own `pressKeys` with slightly different implementations. One handles `<Esc>` via `keyEscape()`, another handles key objects with `ctrl`/`alt`/`shift` modifiers, a third only handles strings.

**Duplicated `visibleBuffer` helper** — Same 4-line function appears in 3 files.

**Duplicated `delay` helper** — 7 test files define their own `delay` or `delay()` closure using `KEY_PRESS_DELAY_MS`.

**Inconsistent key encoding** — Test files use ad-hoc notations (`"<Esc>"`, `"<BS>"`, `"<Del>"`, `{ key: "V", shift: true }`), but `app/src/terminal-key.ts` encodes keys as `'x'` (single-quoted char), `"Space"`, `"Esc"`, `"Ctrl-x"`, etc. No mapping layer exists between test key notation and the app's internal encoding.

**Underutilized `test-utils.ts`** — `keyPress(terminal, key)` and `keyEscape(terminal)` are exported from `test-utils.ts` but most tests call `terminal.keyPress()` directly, bypassing the abstraction.

**Hardcoded inline delays** — `scroll.test.ts` and `search.test.ts` contain `new Promise(r => setTimeout(r, 300))` inline instead of using `RENDER_DELAY_MS`.

The result: adding a new key type (e.g., `"<Tab>"`) requires updating 3+ `pressKeys` functions. The inconsistent encoding makes it unclear what key format the app expects. New test files copy existing ones and perpetuate the duplication.

## Out of Scope

- Adding new test coverage (this is a refactoring story)
- Changing the underlying test framework (`@microsoft/tui-test`)
- Modifying the Rust/NAPI surface
- Changing the app's key encoding in `terminal-key.ts`

## Implementation Approach

### Centralize all test helpers in `test-utils.ts`

Create a single, comprehensive `Keys` utility class/namespace that:

1. **`pressKeys(terminal, keys, options?)`** — Unified key sequence sender that:
   - Handles string keys: `"a"`, `"<Esc>"`, `"<BS>"`, `"<Del>"`, `"<Left>"`, `"<Right>"`, `"<Up>"`, `"<Down>"`, `"<Enter>"`, `"<Space>"`
   - Handles object keys: `{ key: "V", shift: true }`, `{ key: "v", ctrl: true }`, `{ key: "c", ctrl: true }`
   - Applies `KEY_PRESS_DELAY_MS` between keys (configurable via `options.delay`)
   - Uses `terminal.keyEscape()` for `"<Esc>"`, `terminal.keyBackspace()` for `"<BS>"`, `terminal.keyDelete()` for `"<Del>"`, `terminal.keyLeft/Right/Up/Down()` for directional specials

2. **`visibleBuffer(terminal)`** — Move to `test-utils.ts` (was duplicated in 3 files)

3. **`delay(ms?)`** — Export a standard delay function using `KEY_PRESS_DELAY_MS` (was duplicated in 7 files)

4. **`keyPress(terminal, key, options?)`** — Already exists; ensure it handles the same key formats as `pressKeys`

5. **`keyEscape(terminal)`** — Already exists; keep for convenience

6. **Key encoding map** — A `KEY_ALIASES` constant mapping test notation to tui-test API:

   ```typescript
   export const KEY_ALIASES: Record<string, string | { key: string; ctrl?: boolean; alt?: boolean; shift?: boolean }> = {
     "<Esc>": "Escape",           // handled via terminal.keyEscape()
     "<BS>": "Backspace",         // handled via terminal.keyBackspace()
     "<Del>": "Delete",            // handled via terminal.keyDelete()
     "<Left>": "Left",             // handled via terminal.keyLeft()
     "<Right>": "Right",
     "<Up>": "Up",
     "<Down>": "Down",
     "<Enter>": "Enter",
     "<Space>": " ",               // Space is sent as " " not "Space"
     "vim-V": { key: "V", shift: true },  // shift+V for linewise visual
     "vim-v": "v",                 // lowercase v
     "vim-ctrl-v": { key: "v", ctrl: true }, // blockwise
     // ... more as needed
   }
   ```

   This gives tests a consistent vocabulary that maps to both the tui-test API and (eventually) the app's `terminal-key.ts` encoding.

### Replace all duplicated helpers

For each test file:

1. Remove local `pressKeys` definition — use `keys.pressKeys` from `test-utils.js`
2. Remove local `visibleBuffer` definition — use `keys.visibleBuffer` from `test-utils.js`
3. Remove local `delay` definition — use `keys.delay` from `test-utils.js`
4. Replace inline `new Promise(r => setTimeout(r, N))` with `keys.delay(N)` or just `keys.delay()`
5. Optionally adopt `KEY_ALIASES` for special key notation (e.g., `"<Esc>"` instead of `"Escape"`)

### Ensure backward compatibility

The existing `keyPress` and `keyEscape` exports from `test-utils.ts` must continue to work. Tests importing these should not break. The new `Keys` class is an additive enhancement.

## Tasks

### Task 1 — Expand `test-utils.ts` with unified `Keys` utility

Add to `app/tests/e2e/test-utils.ts`:

1. **`Keys` class** with static methods:
   - `pressKeys(terminal, keys: KeyInput[], options?: { delay?: number })` — sends a sequence of keys
   - `visibleBuffer(terminal)` — returns the viewable buffer as a joined string
   - `delay(ms?: number)` — returns a promise that resolves after `KEY_PRESS_DELAY_MS` (or given ms)

2. **`KeyInput` type**:
   ```typescript
   export type KeyInput = string | { key: string; ctrl?: boolean; alt?: boolean; shift?: boolean }
   ```

3. **`KEY_ALIASES` constant** (optional, for readability):
   ```typescript
   export const KEY_ALIASES = {
     "<Esc>": "Escape",   // uses keyEscape() internally
     "<BS>": "Backspace", // uses keyBackspace() internally
     "<Del>": "Delete",   // uses keyDelete() internally
     // ... etc
   } as const
   ```

4. **`keyPress` update** — Update the existing `keyPress` helper to delegate to the new `Keys` class, handling `"<Esc>"`, `"<BS>"`, `"<Del>"` via their dedicated methods.

#### Acceptance Criteria

- `keys.pressKeys(terminal, ["i", "a", "b", "<Esc>"])` works (string keys)
- `keys.pressKeys(terminal, ["v", { key: "l", shift: true }])` works (object keys with modifiers)
- `keys.pressKeys(terminal, ["<Esc>"])` uses `terminal.keyEscape()` internally
- `keys.visibleBuffer(terminal)` returns the same string as before
- `keys.delay()` returns a promise that resolves after ~50ms
- `keys.delay(200)` returns a promise that resolves after ~200ms
- All existing tests that import `keyPress`, `keyEscape`, `test`, `expect`, `RENDER_DELAY_MS`, `KEY_PRESS_DELAY_MS` continue to work without modification
- `bunx @microsoft/tui-test app/tests/e2e/*.test.ts` passes

#### Non-Automatable

None.

---

### Task 2 — Refactor `vim-mode.test.ts` to use `Keys`

Modify `app/tests/e2e/vim-mode.test.ts`:

1. Remove local `delay` closure (line 3)
2. Remove local `visibleBuffer` function (lines 5-9)
3. Remove local `pressKeys` function (lines 11-41)
4. Import `keys` from `test-utils.js`
5. Replace all calls to local helpers with `keys.*`

#### Acceptance Criteria

- No local `delay`, `visibleBuffer`, or `pressKeys` definitions remain
- All test cases pass: `"insert mode writes text"`, `"insert mode supports backspace"`, `"insert mode delete removes"`, `"W and ciW operate on big words"`
- `bunx @microsoft/tui-test app/tests/e2e/vim-mode.test.ts` passes

#### Non-Automatable

None.

---

### Task 3 — Refactor `visual-mode.test.ts` to use `Keys`

Modify `app/tests/e2e/visual-mode.test.ts`:

1. Remove local `delay` closure (line 3)
2. Remove local `visibleBuffer` function (lines 5-9)
3. Remove local `pressKeys` function (lines 19-36)
4. Import `keys` from `test-utils.js`
5. Replace all calls to local helpers with `keys.*`

#### Acceptance Criteria

- No local `delay`, `visibleBuffer`, or `pressKeys` definitions remain
- All visual mode test cases pass (charwise, linewise, blockwise selections and deletes)
- `bunx @microsoft/tui-test app/tests/e2e/visual-mode.test.ts` passes

#### Non-Automatable

None.

---

### Task 4 — Refactor `undo-redo.test.ts` to use `Keys`

Modify `app/tests/e2e/undo-redo.test.ts`:

1. Remove local `delay` closure (line 3)
2. Remove local `visibleBuffer` function (lines 5-9)
3. Remove local `pressKeys` function (lines 11-26)
4. Import `keys` from `test-utils.js`
5. Replace all calls to local helpers with `keys.*`

#### Acceptance Criteria

- No local `delay`, `visibleBuffer`, or `pressKeys` definitions remain
- All undo/redo test cases pass
- `bunx @microsoft/tui-test app/tests/e2e/undo-redo.test.ts` passes

#### Non-Automatable

None.

---

### Task 5 — Refactor remaining test files to use `keys.delay()`

For each of these files, replace inline `new Promise(r => setTimeout(r, N))` calls with `keys.delay(N)`:

- `search.test.ts` — uses inline delays on lines 5, 8, 18, 26-30, 38, 40, etc.
- `scroll.test.ts` — uses inline delays on lines 12, 22, 27, 37, 46, 53, 62, 67
- `sentence-motion.test.ts` — uses inline delays on lines 11, 15, 25, 29, 33
- `cursor-visibility.test.ts` — uses inline delays on lines 15, 17, 27, 43
- `status-bar.test.ts` — uses inline delays on lines 7, 12, 17, 22, 27, 33, 35, 39

Import `keys` from `test-utils.js` and use `keys.delay()` consistently.

#### Acceptance Criteria

- All listed files use `keys.delay()` instead of inline promise-creating delays
- All test cases in these files pass
- `bunx @microsoft/tui-test app/tests/e2e/*.test.ts` passes

#### Non-Automatable

None.

---

### Task 6 — Add E2E test coverage for `Keys` utility

Add a new file `app/tests/e2e/keys-utils.test.ts` that validates the new `Keys` utility directly:

1. Test `keys.delay()` resolves after ~50ms
2. Test `keys.delay(100)` resolves after ~100ms
3. Test `keys.pressKeys` sends keys in order with delays between them
4. Test `keys.pressKeys` with `"<Esc>"` calls `terminal.keyEscape()`
5. Test `keys.pressKeys` with `{ key: "v", ctrl: true }` sends with modifiers
6. Test `keys.visibleBuffer` returns a non-empty string for a working terminal

#### Acceptance Criteria

- `keys-utils.test.ts` exists and covers the above cases
- `bunx @microsoft/tui-test app/tests/e2e/keys-utils.test.ts` passes

#### Non-Automatable

None.

## Bootstrap

```bash
# No new dependencies required — all work is refactoring existing code

# Run all tests to verify baseline
just test-e2e

# Run a specific test file during refactoring
bunx @microsoft/tui-test app/tests/e2e/vim-mode.test.ts
```

## Technical Context

- **@microsoft/tui-test**: `0.0.3` (installed in both root and app `package.json`)
- **bun**: `1.3.x` (Bun v1.3.11 detected in environment)
- **Existing helpers** in `test-utils.ts`: `keyPress`, `keyEscape`, `withLog`, `testConfig`, `RENDER_DELAY_MS`, `KEY_PRESS_DELAY_MS`
- **Terminal key types** used by `@microsoft/tui-test`:
  - `terminal.keyPress(key, opts?)` — sends a key with optional modifiers
  - `terminal.keyEscape()` — dedicated method for Escape
  - `terminal.keyBackspace()` — dedicated method for Backspace
  - `terminal.keyDelete()` — dedicated method for Delete
  - `terminal.keyLeft/Right/Up/Down()` — dedicated methods for arrows
- **App key encoding** (`app/src/terminal-key.ts`): Uses single-quoted chars (`'x'`), `"Space"`, `"Esc"`, `"Ctrl-x"`, etc. This is separate from the test key notation and is NOT changed by this story.
- **No changes to Rust/NAPI** — this story is purely TypeScript refactoring

## Notes

- The `Keys` class is named with a capital `K` to distinguish it from the generic `key` variables used throughout tests.
- The `KEY_ALIASES` constant is optional — if the `pressKeys` function handles `"<Esc>"` directly via its internal mapping, tests can use that notation without importing `KEY_ALIASES`.
- The `delay` function in `Keys` uses `setTimeout` internally and is intentionally simple — no need for a tick-based solution.
- When refactoring `search.test.ts`, preserve the existing `typeSearch` function if it serves a useful purpose (it handles the `/` prefix and `Enter` suffix differently). Only replace the inline delays within it.
- The `tui-test.config.ts` currently has `workers: 100` which may contribute to flakiness. This is noted in `AGENTS.md` but is outside the scope of this story.