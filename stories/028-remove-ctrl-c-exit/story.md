# Remove Ctrl+C custom exit — let keymap handle it naturally

## Context

Ctrl+C currently calls `shutdown(0)` at the top of the event loop (`index.ts:179-182`), bypassing the Vim engine entirely. This is custom code outside the Vim keymap. With `:q` and `:wq` ex commands now working (story 020), there is a proper Vim-native way to quit. Removing the hard intercept lets Ctrl+C flow through the existing `<C-c> → <Esc>` keymap mapping, giving standard Vim behavior: Ctrl+C acts like Esc (exits insert/visual mode, cancels prompts). No custom handling remains.

## Out of Scope

- Adding dirty-buffer protection to `:q` (e.g. `:q` warning when unsaved changes exist) — that is a separate feature.
- Changing the SIGINT signal handler — external `kill -INT` must still shut down cleanly.
- Adding new ex commands beyond what already exists.

## Implementation approach

1. **Remove the Ctrl+C intercept** from the event loop in `packages/app/src/index.ts` (lines 179-182). The `if` block that checks `event.modifiers.includes("Ctrl") && normalizeCtrlCharacter(event.key) === "c"` and calls `shutdown(0)` is deleted entirely. After this, Ctrl+C is encoded as `"Ctrl-c"` by `encodeTerminalKey` and passed to `VimMode.handleKey`, where the existing `<C-c> → <Esc>` keymap mapping handles it.

2. **Remove the `normalizeCtrlCharacter` import** from `index.ts` — it is only used by the deleted Ctrl+C check. The function itself stays in `terminal-key.ts` (it is still used inside `encodeTerminalKey`).

3. **Rewrite the exit E2E test** — the existing `exit.test.ts` test "Ctrl+C exits cleanly" must be replaced with a test that verifies Ctrl+C does NOT exit the app (it now acts like Esc via the keymap).

4. **Update AGENTS.md** — remove the "Ctrl-C" gotcha entry entirely, since Ctrl+C is no longer special-cased. It flows through the keymap like any other key.

5. **Update `docs/product.md`** — change the feature entry from "Ctrl+C exit and visual mode" to reflect that Ctrl+C now acts like Esc via the keymap, and `:q` is the quit command.

### Key encoding flow (after change)

```
Ctrl+C key event → encodeTerminalKey → "Ctrl-c"
  → VimMode.handleKey("Ctrl-c")
    → If prompting: handlePromptKey → decodeKey → {key:"c", ctrlKey:true}
      → makePromptKeyDown: keyName "Ctrl-c" → no match for cancel condition
      → applyKeyToQuery: ctrlKey is set → no character appended → no-op in prompt
      (Note: Ctrl+C does NOT cancel prompts — only Esc and Ctrl-[ do)
    → If NOT prompting: cmKey → cmKeyToVimKey("Ctrl-c") → "<C-c>"
      → keymap match: <C-c> → <Esc> → standard Esc behavior
```

## Tasks

### Task 1 — Remove Ctrl+C intercept from event loop

- In `packages/app/src/index.ts`, delete lines 179-182 (the `if` block that intercepts Ctrl+C and calls `shutdown(0)`).
- Remove `normalizeCtrlCharacter` from the import on line 19 (it is no longer used in this file; `encodeTerminalKey` still uses it internally).
- After the change, Ctrl+C key events reach `processKeyEvent` and are encoded as `"Ctrl-c"` by `encodeTerminalKey`.

AC:
- Ctrl+C in normal mode does NOT call `shutdown(0)` — the app stays running.
- Ctrl+C in normal mode is encoded as `"Ctrl-c"` and reaches `VimMode.handleKey`.
- `normalizeCtrlCharacter` is not imported in `index.ts` (but still exported from `terminal-key.ts`).

### Task 2 — Rewrite E2E tests for new Ctrl+C behavior

- In `packages/app/tests/e2e/exit.test.ts`:
  - Replace the "Ctrl+C exits cleanly" test with: "Ctrl+C does not exit the app" — press Ctrl+C, wait 300ms, verify the app is still running (`exitResult` is null).
  - Keep the "app stays running without Ctrl+C" test unchanged.
- Add a new test file `packages/app/tests/e2e/ctrl-c-esc.test.ts`:
  - "Ctrl+C exits insert mode" — enter insert mode (`i`), verify status bar shows "INSERT", press Ctrl+C, verify status bar shows "NORMAL".
  - "Ctrl+C exits visual mode" — enter visual line mode (`V`), verify status bar shows "V-LINE", press Ctrl+C, verify status bar shows "NORMAL".

AC:
- `just test-e2e` passes with all new and modified tests.
- No test relies on Ctrl+C exiting the process.

### Task 3 — Update documentation

- In `AGENTS.md`, remove the "Ctrl-C" gotcha entry entirely. Ctrl+C is no longer special-cased — it flows through the Vim keymap like any other key.
- In `docs/product.md`, update the feature entry "Ctrl+C exit and visual mode" (story 006) to say: "Visual mode rendering; Ctrl+C acts like Esc via the `<C-c> → <Esc>` keymap mapping; `:q` is the quit command."

AC:
- AGENTS.md has no mention of Ctrl-C in the gotchas section.
- product.md reflects that Ctrl+C acts like Esc and `:q` is the quit mechanism.

## Technical Context

- No new dependencies.
- The `<C-c> → <Esc>` keymap mapping already exists in `packages/vim/src/default-key-map.ts` (lines 22 and 24) for both normal and insert contexts. It was dead code while Ctrl+C was intercepted; it now becomes active.
- The SIGINT handler (`process.on("SIGINT", handleSigint)` at `index.ts:158`) remains unchanged — it handles OS-level signals (e.g. `kill -INT <pid>`), not terminal key events.
- `encodeTerminalKey` in `packages/app/src/terminal-key.ts` produces `"Ctrl-c"` (lowercase) for Ctrl+C. The `cmKeyToVimKey` function in `packages/vim/src/keymap_vim.ts` translates `"Ctrl-c"` → `"<C-c>"`, which matches the keymap entry.
- In prompt mode, `handlePromptKey` decodes `"Ctrl-c"` to `{key: "c", ctrlKey: true}`. `getEventKeyName` returns `"Ctrl-c"`. `makePromptKeyDown` does not match `"Ctrl-c"` (only `"Esc"`, `"Ctrl-["`, and `"Backspace"` on empty input cancel prompts). `applyKeyToQuery` does not append the character because `ctrlKey` is true. Result: Ctrl+C is a no-op in prompts — only Esc and Ctrl-[ cancel them.

## Notes

- The `@microsoft/tui-test` terminal API provides `terminal.keyCtrlC()` for E2E tests. After this change, `keyCtrlC()` sends a Ctrl+C key event that reaches the Vim engine instead of triggering process exit.
- In real Vim, Ctrl+C also cancels prompts. In revim, Ctrl+C is a no-op in prompts because prompts bypass the keymap and `makePromptKeyDown` only cancels on Esc/Ctrl-[. This matches the existing behavior of the `<C-[>` mapping which also only works outside prompts. Adding Ctrl+C to the prompt cancel condition would be custom handling outside the keymap, which this story explicitly avoids.
- The SIGINT handler is intentionally kept: it ensures `kill -INT <pid>` and similar external signals still trigger a clean shutdown.