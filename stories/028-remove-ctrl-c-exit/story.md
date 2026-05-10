# Remove Ctrl+C exit — delegate to `:q` and Vim keymap

## Context

Ctrl+C currently calls `shutdown(0)` at the top of the event loop (`index.ts:179-182`), bypassing the Vim engine entirely. With `:q` and `:wq` ex commands now working (story 020), there is a proper Vim-native way to quit. Removing the hard intercept lets Ctrl+C flow through the existing `<C-c> → <Esc>` keymap mapping, giving standard Vim behavior: cancel the current operation (exit insert/visual mode, cancel a prompt) instead of terminating the process.

## Out of Scope

- Adding dirty-buffer protection to `:q` (e.g. `:q` warning when unsaved changes exist) — that is a separate feature.
- Changing the SIGINT signal handler — external `kill -INT` must still shut down cleanly.
- Adding new ex commands beyond what already exists.

## Implementation approach

1. **Remove the Ctrl+C intercept** from the event loop in `packages/app/src/index.ts` (lines 179-182). The `if` block that checks `event.modifiers.includes("Ctrl") && normalizeCtrlCharacter(event.key) === "c"` and calls `shutdown(0)` is deleted entirely. After this, Ctrl+C is encoded as `"Ctrl-c"` by `encodeTerminalKey` and passed to `VimMode.handleKey`, where the existing `<C-c> → <Esc>` keymap mapping handles it.

2. **Remove the `normalizeCtrlCharacter` import** from `index.ts` — it is only used by the deleted Ctrl+C check. The function itself stays in `terminal-key.ts` (it is still used inside `encodeTerminalKey`).

3. **Add `Ctrl-c` to the prompt cancel condition** in `packages/vim/src/command-dispatcher.ts` (`makePromptKeyDown`, line 69). When the user is in a prompt (ex command line, search), `handlePromptKey` routes keys through `makePromptKeyDown` instead of the Vim keymap. Currently only `Esc` and `Ctrl-[` cancel prompts. Add `keyName === "Ctrl-c"` so Ctrl+C cancels the prompt without executing the command, matching Vim behavior.

4. **Rewrite the exit E2E test** — the existing `exit.test.ts` test "Ctrl+C exits cleanly" must be replaced with a test that verifies Ctrl+C does NOT exit (it cancels insert mode instead). Add a new test for Ctrl+C canceling an ex command prompt.

5. **Update AGENTS.md** — remove the "Ctrl-C is intercepted at the event loop" gotcha entry, since Ctrl+C now reaches the Vim engine. The note about `keyName === "Ctrl-C"` (uppercase) being dead code stays relevant but is reworded to reflect the new flow.

6. **Update `docs/product.md`** — change the feature entry from "Ctrl+C exit and visual mode" to reflect that Ctrl+C now behaves like Esc, and `:q` is the quit mechanism.

### Key encoding flow (after change)

```
Ctrl+C key event → encodeTerminalKey → "Ctrl-c"
  → VimMode.handleKey("Ctrl-c")
    → If prompting: handlePromptKey → decodeKey → {key:"c", ctrlKey:true}
      → makePromptKeyDown: keyName "Ctrl-c" → cancel prompt (same as Esc)
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

### Task 2 — Add Ctrl+C to prompt cancel condition

- In `packages/vim/src/command-dispatcher.ts`, line 69, change the condition from:
  ```
  keyName === "Esc" || keyName === "Ctrl-["
  ```
  to:
  ```
  keyName === "Esc" || keyName === "Ctrl-[" || keyName === "Ctrl-c"
  ```

AC:
- In ex command prompt (`:`), pressing Ctrl+C cancels the prompt and returns to normal mode (same as Esc).
- In search prompt (`/`), pressing Ctrl+C cancels the prompt and returns to normal mode (same as Esc).
- Enter still submits the prompt; Backspace on empty input still cancels.

### Task 3 — Rewrite E2E tests for new Ctrl+C behavior

- In `packages/app/tests/e2e/exit.test.ts`:
  - Replace the "Ctrl+C exits cleanly" test with: "Ctrl+C does not exit the app" — press Ctrl+C, wait 300ms, verify the app is still running (`exitResult` is null).
  - Keep the "app stays running without Ctrl+C" test unchanged.
- Add a new test file `packages/app/tests/e2e/ctrl-c-behavior.test.ts` (or add to existing test file):
  - "Ctrl+C exits insert mode" — enter insert mode (`i`), press Ctrl+C, verify the status bar shows "NORMAL" (no longer in insert mode).
  - "Ctrl+C cancels ex command prompt" — type `:`, press Ctrl+C, verify the prompt is closed and the status bar returns to normal (no `:` visible).

AC:
- `just test-e2e` passes with all new and modified tests.
- No test relies on Ctrl+C exiting the process.

### Task 4 — Update documentation

- In `AGENTS.md`, replace the "Ctrl-C" gotcha entry with: "Ctrl-C reaches the Vim engine via the `<C-c> → <Esc>` keymap mapping. In prompt mode (ex commands, search), Ctrl-C cancels the prompt. `:q` is the way to quit. `encodeTerminalKey` lowercases Ctrl combos, so `keyName === "Ctrl-C"` (uppercase) in handlers is dead code — always use lowercase `Ctrl-c`."
- In `docs/product.md`, update the feature entry "Ctrl+C exit and visual mode" (story 006) to say: "Ctrl+C behaves like Esc (cancels operations, exits insert/visual mode); `:q` is the quit command."

AC:
- AGENTS.md no longer says Ctrl+C is intercepted at the event loop.
- product.md reflects that Ctrl+C behaves like Esc and `:q` is the quit mechanism.

## Technical Context

- No new dependencies.
- The `<C-c> → <Esc>` keymap mapping already exists in `packages/vim/src/default-key-map.ts` (lines 22 and 24) for both normal and insert contexts. It was dead code while Ctrl+C was intercepted; it now becomes active.
- The SIGINT handler (`process.on("SIGINT", handleSigint)` at `index.ts:158`) remains unchanged — it handles OS-level signals (e.g. `kill -INT <pid>`), not terminal key events.
- `encodeTerminalKey` in `packages/app/src/terminal-key.ts` produces `"Ctrl-c"` (lowercase) for Ctrl+C. The `cmKeyToVimKey` function in `packages/vim/src/keymap_vim.ts` translates `"Ctrl-c"` → `"<C-c>"`, which matches the keymap entry.

## Notes

- The `@microsoft/tui-test` terminal API provides `terminal.keyCtrlC()` for E2E tests. After this change, `keyCtrlC()` sends a Ctrl+C key event that reaches the Vim engine instead of triggering process exit.
- In real Vim, Ctrl+C can also interrupt long-running operations. Since revim doesn't have long-running operations yet, the `<C-c> → <Esc>` mapping is sufficient.
- The SIGINT handler is intentionally kept: it ensures `kill -INT <pid>` and similar external signals still trigger a clean shutdown.