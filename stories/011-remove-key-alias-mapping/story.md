# Remove Key Alias Mapping

## Context

The key pipeline from hardware input to the Vim state machine passes through an unnecessary double-mapping step.

In `lib/src/tui/api.rs`, the `start_keyboard_listener` match arm emits browser-style names for four keys that the TypeScript layer never actually uses: `"ArrowUp"`, `"ArrowDown"`, `"ArrowLeft"`, `"ArrowRight"`, and `"Escape"`. Immediately on the TypeScript side, `terminal-key.ts` declares a `keyAliases` table that renames those same five values to the canonical names the Vim layer expects (`"Up"`, `"Down"`, `"Left"`, `"Right"`, `"Esc"`). Nine additional entries in that table (`Enter→Enter`, `Backspace→Backspace`, `Tab→Tab`, `Delete→Delete`, `Insert→Insert`, `Home→Home`, `End→End`, `PageUp→PageUp`, `PageDown→PageDown`) are identity mappings — dead code that never changes a value.

Because the Rust names are not derived from any external contract (they are hand-written strings in a `match` arm), they can simply be changed to the canonical names the downstream code already requires. This makes the `keyAliases` table obsolete and removes it entirely.

## Out of Scope

- Changes to the `cmKeyToVimKey` translation in `keymap_vim.ts` (Vim `<>` notation layer).
- Changes to the `normalizeCtrlCharacter` helper (a separate concern: raw control-character bytes from crossterm).
- Adding new key codes or extending coverage beyond the five renamed keys.

## Implementation approach

**Full pipeline for reference (pre-change):**
```
crossterm KeyCode
  → api.rs match arm  → KeyboardEvent { key, modifiers }
  → N-API / FFI
  → encodeTerminalKey() with keyAliases  → encoded string ("Up", "'x'", "Ctrl-f")
  → cmKeyToVimKey()                      → vim notation ("<Up>", "x", "<C-f>")
  → Vim keymap lookup
```

**Changes:**

1. **`lib/src/tui/api.rs`** — change five match arms to emit canonical names directly:
   - `KeyCode::Up`    → `"Up"` (was `"ArrowUp"`)
   - `KeyCode::Down`  → `"Down"` (was `"ArrowDown"`)
   - `KeyCode::Left`  → `"Left"` (was `"ArrowLeft"`)
   - `KeyCode::Right` → `"Right"` (was `"ArrowRight"`)
   - `KeyCode::Esc`   → `"Esc"` (was `"Escape"`)

2. **`app/src/terminal-key.ts`** — delete the `keyAliases` table and simplify `encodeTerminalKey`:
   - Remove the `const keyAliases` declaration entirely.
   - Change the first line of `encodeTerminalKey` from `let key = keyAliases[event.key] || event.key` to `let key = event.key`.

No other files change. The `RawTerminalKeyEvent` interface, `normalizeCtrlCharacter`, and the Ctrl+c guard in `index.ts` are all unaffected.

After the change the pipeline is:
```
crossterm KeyCode
  → api.rs match arm  → KeyboardEvent { key, modifiers }   ← now emits canonical names
  → N-API / FFI
  → encodeTerminalKey()  → encoded string (no alias table)
  → cmKeyToVimKey()      → vim notation
  → Vim keymap lookup
```

## Tasks

### Task 1 - Emit canonical key names from Rust and remove TS alias table

#### Acceptance Criteria

- `lib/src/tui/api.rs` emits `"Up"`, `"Down"`, `"Left"`, `"Right"`, `"Esc"` for the corresponding `KeyCode` variants.
- `app/src/terminal-key.ts` contains no `keyAliases` declaration.
- `encodeTerminalKey` first line is `let key = event.key` (no alias lookup).
- All existing E2E tests pass: arrow key movement, Escape to return to normal mode, and any test that exercises `<Left>`, `<Right>`, `<Up>`, `<Down>` key-to-key mappings.
- `just check` exits 0.

#### Non-Automatable

- Manually verify arrow-key cursor movement and Escape still work in a live terminal session after the Rust rebuild.

## Technical Context

No new dependencies. The change touches two existing files.

The Rust crate must be rebuilt after editing `api.rs` so that the generated N-API bindings pick up the new string values. The normal `just check` / `just test` flow handles this.
