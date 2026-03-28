# Fork vim-monaco into ReVim

## Context

`vim-monaco/` is a git-cloned copy of [pollrobots/vim-monaco](https://github.com/pollrobots/vim-monaco) — a TypeScript vim mode for the Monaco browser editor. ReVim needs a vim state machine (motions, operators, keymaps, ex commands) for its terminal editor. Rather than building from scratch, we fork vim-monaco's logic into the repo, strip all browser/Monaco dependencies, and wire it to the existing Rust/ratatui backend via NAPI-RS FFI.

This story covers:
1. Moving the source into `app/src/vim/` and removing the separate `vim-monaco/` git repo.
2. Stripping all browser globals (`window.monaco.*`, `window.crypto`, DOM types) and Monaco-specific types.
3. Replacing `EditorAdapter` (which wraps Monaco APIs) with a `TerminalAdapter` that calls the Rust layer via NAPI-RS for text buffer and cursor operations.
4. Defining the NAPI-RS FFI surface needed to support the adapter.

## Out of Scope

- Full vim feature parity — only the adapter seam and FFI surface are implemented; existing vim logic is preserved as-is.
- The DOM `StatusBar` implementation (`statusbar.ts` `StatusBar` class) — keep the `IStatusBar` interface, delete the DOM implementation; a terminal status bar is a follow-up story.
- `makeDomStatusBar` export from `index.ts`.
- The `build.js` / `version.ts` generation script — not needed outside the npm package context.
- The `digraph.src.js` build step — `digraph.ts` is kept as-is.
- Cross-platform Rust builds.

## Implementation approach

### File layout after migration

All 23 TypeScript source files from `vim-monaco/src/` move to `app/src/vim/`. Files that are pure logic with no browser dependencies (`actions.ts`, `command-dispatcher.ts`, `default-key-map.ts`, `digraph.ts`, `ex-command-dispatcher.ts`, `global.ts`, `history-controller.ts`, `input-state.ts`, `jump-list.ts`, `macro-mode-state.ts`, `motions.ts`, `operators.ts`, `options.ts`, `register-controller.ts`, `search.ts`, `string-stream.ts`, `types.ts`) are copied verbatim (imports adjusted for new path).

Files requiring surgery:

| File | Change |
|---|---|
| `common.ts` | Remove `import { IKeyboardEvent } from "monaco-editor"`. Replace `window.monaco.KeyCode` lookup in `getEventKeyName` with a plain string passthrough — terminal keys arrive as strings already, not Monaco keycodes. |
| `adapter.ts` | Delete entirely. Replace with `terminal-adapter.ts` (see below). |
| `statusbar.ts` | Delete `StatusBar` class and DOM imports. Keep `IStatusBar`, `ModeChangeEvent`, `StatusBarInputOptions` interfaces. |
| `index.ts` | Remove `makeDomStatusBar`, `import monaco`, DOM types. Keep `VimMode` class, `FileEvent`, `IRegister`, `IStatusBar` re-exports. Replace `EditorAdapter` with `TerminalAdapter`. |
| `vim-api.ts` | Replace `window.clearTimeout` with `clearTimeout` (global in Node/Bun). |
| `keymap_vim.ts` | No browser globals — copy verbatim, adjust import path for `adapter`. |
| `build.js`, `digraph.src.js` | Delete (build artifacts, not needed). |

### TerminalAdapter

`app/src/vim/terminal-adapter.ts` implements the same interface as `EditorAdapter` (same public method signatures used by `keymap_vim.ts`, `actions.ts`, `motions.ts`, `operators.ts`, `command-dispatcher.ts`). All text/cursor operations delegate to NAPI-RS FFI calls into Rust.

Key method groups and their FFI mapping:

| Adapter method group | NAPI-RS function(s) |
|---|---|
| `getLine(n)`, `lineCount()`, `firstLine()`, `lastLine()` | `getLine(n: number): string`, `getLineCount(): number` |
| `getCursor()`, `setCursor(line, ch)` | `getCursorPos(): {line,ch}`, `setCursorPos(line,ch)` |
| `getRange(start, end)` | `getRange(startLine,startCh,endLine,endCh): string` |
| `replaceRange(text, start, end?)` | `replaceRange(text,startLine,startCh,endLine,endCh)` |
| `getSelection()`, `listSelections()`, `setSelections()`, `setSelection()` | `getSelection(): {anchor,head}`, `setSelection(anchorLine,anchorCh,headLine,headCh)` |
| `replaceSelections(texts)` | `replaceSelections(texts: string[])` |
| `indentLine(line, right)` | `indentLine(line,indentRight: boolean)` |
| `indexFromPos(pos)`, `posFromIndex(offset)` | `indexFromPos(line,ch): number`, `posFromIndex(offset): {line,ch}` |
| `findFirstNonWhiteSpaceCharacter(line)` | `getLineFirstNonWhitespace(line): number` |
| `getScrollInfo()` | `getScrollInfo(): {top,clientHeight,height}` |
| `scrollTo(x,y)` | `scrollTo(y: number)` |
| `clipPos(pos)` | `clipPos(line,ch): {line,ch}` |
| `pushUndoStop()` | `pushUndoStop()` |
| `triggerEditorAction(action)` | `triggerAction(action: string)` (redo/undo/newlineAndIndent) |
| `dispatch(signal, ...args)` / `on(event, handler)` | Pure TypeScript event emitter — no FFI |
| `enterVimMode()`, `leaveVimMode()` | `setVimMode(active: boolean)` — updates cursor style in ratatui |
| `toggleOverwrite(toggle)` | `setReplaceMode(active: boolean)` |
| `findMatchingBracket(pos)` | Pure TypeScript (uses `getLine`) |
| `getSearchCursor(pattern, pos)` | Pure TypeScript (uses `getLine` + `getRange`) |
| `highlightRanges()`, `addOverlay()`, `removeOverlay()` | `setHighlights(ranges: Array<{startLine,startCh,endLine,endCh}>)` |
| `moveCurrentLineTo(pos)` | `scrollToLine(line, position: 'top'|'center'|'bottom')` |
| `findPosV(start, amount, unit)` | Pure TypeScript (uses `getScrollInfo`) |
| `charCoords()`, `coordsChar()` | Stub returning `{top: pos.line, left: pos.ch}` — not used by core vim logic |
| `getUserVisibleLines()` | `getVisibleLines(): {top, bottom}` |
| `focus()` | `focusEditor()` |
| `smartIndent()` | `triggerAction('formatSelection')` |
| `moveH(amount, 'char')` | `setCursorPos` after computing new position |
| `displayMessage(msg)` | `dispatch('status-display', ...)` — pure TS |
| `openPrompt(...)` | `dispatch('status-prompt', ...)` — pure TS |
| `openNotification(msg)` | `dispatch('status-notify', ...)` — pure TS |

`window.crypto.randomUUID()` in `displayMessage`/`openPrompt` → replace with a simple incrementing counter (`let _id = 0; const nextId = () => String(++_id)`).

`Marker` and `CmSelection` classes move into `terminal-adapter.ts` unchanged (no browser deps).

`KeyMapEntry`, `BindingFunction`, `Change`, `Operation` types move into `terminal-adapter.ts`.

`lookupKey` static method moves into `terminal-adapter.ts` unchanged.

`EditorAdapter.commands` static map moves to `TerminalAdapter.commands`.

`EditorAdapter.keyMap` static map moves to `TerminalAdapter.keyMap`.

### Rust FFI additions (lib/src/tui.rs)

Add the NAPI-RS functions listed in the table above. The Rust side maintains a `TextBuffer` struct (lines: `Vec<String>`) and `Selection` struct alongside the existing `TuiState`. All new functions operate on `TUI_CONTEXT` mutex.

The `TextBuffer` is initialized with the existing demo text. Cursor position already exists in `TuiState` — extend it with `anchor_row`/`anchor_col` for selection support.

### Key invariants

- `Pos` uses 0-based line/ch throughout TypeScript; Rust functions use the same 0-based convention.
- `replaceRange` with no `end` argument means single-point insert (end = start).
- `getLine` clamps out-of-range lines to empty string (existing behavior preserved).
- `clipPos` clamps to valid buffer bounds.
- `getSearchCursor` is implemented purely in TypeScript using `getLine` — no Rust search needed at this stage.

## Tasks

### Task 1 - Move vim-monaco source into app/src/vim/

Copy all 23 `.ts` files from `vim-monaco/src/` to `app/src/vim/`. Delete `build.js`, `digraph.src.js`. Remove the `vim-monaco/` directory (the separate git repo) from the working tree. Do not add it as a git submodule.

#### Acceptance Criteria

- `vim-monaco/` directory no longer exists in the repo root
- `app/src/vim/` contains all 23 TypeScript source files (minus `build.js`, `digraph.src.js`, `version.ts`)
- No file in `app/src/vim/` imports from `"monaco-editor"` or references `window.monaco`
- `tsc --noEmit` on `app/` passes with zero errors

#### Non-Automatable

- Verify the `vim-monaco/` git repo is fully removed (not just the directory) — confirm `git status` shows no untracked `.git` nested repo.

### Task 2 - Strip browser globals and Monaco types

Apply the per-file changes described in Implementation approach:
- `common.ts`: remove Monaco import, simplify `getEventKeyName` to accept a plain `{key: string, ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean, metaKey?: boolean}` shape (a `TerminalKeyEvent` interface defined in `terminal-adapter.ts`).
- `statusbar.ts`: delete `StatusBar` class and all DOM code; keep interfaces only.
- `index.ts`: remove `makeDomStatusBar`, Monaco import, DOM types; wire to `TerminalAdapter`.
- `vim-api.ts`: replace `window.clearTimeout` with `clearTimeout`.

#### Acceptance Criteria

- `grep -r "window\." app/src/vim/` returns zero matches
- `grep -r "document\." app/src/vim/` returns zero matches
- `grep -r "HTMLElement\|HTMLInput" app/src/vim/` returns zero matches
- `grep -r "from \"monaco-editor\"" app/src/vim/` returns zero matches
- `tsc --noEmit` on `app/` passes with zero errors

#### Non-Automatable

- Manual review: `IStatusBar` interface is intact and unchanged in `statusbar.ts`
- Manual review: `VimMode` class in `index.ts` still compiles and exports `enable()`, `disable()`, `executeCommand()`, `setOption()`, `setClipboardRegister()`

### Task 3 - Implement TerminalAdapter

Create `app/src/vim/terminal-adapter.ts` implementing the full `EditorAdapter` interface surface used by the vim logic. All text/cursor operations call NAPI-RS stubs (functions that throw `"not implemented"` initially — filled in Task 4).

The adapter must:
- Export `TerminalAdapter` class with all methods listed in the Implementation approach table
- Export `CmSelection`, `Marker`, `KeyMapEntry`, `BindingFunction`, `Change` types
- Export `TerminalAdapter.keyMap` and `TerminalAdapter.commands` static maps
- Use incrementing counter for IDs (no `window.crypto`)
- Implement `findMatchingBracket` and `getSearchCursor` in pure TypeScript

#### Acceptance Criteria

- `tsc --noEmit` on `app/` passes with zero errors after wiring `index.ts` to `TerminalAdapter`
- `TerminalAdapter` instantiates without throwing when NAPI stubs are present
- All event `on()`/`off()`/`dispatch()` calls work correctly: handler registered with `on('change', fn)` is called when `dispatch('change', ...)` is invoked

#### Non-Automatable

- Manual review: every method in the Implementation approach table is present in `TerminalAdapter`

### Task 4 - Add NAPI-RS FFI functions to Rust

Add the Rust functions listed in the Implementation approach table to `lib/src/tui.rs`. Add `TextBuffer` and selection fields to `TuiState`. Wire `TerminalAdapter` to call the real NAPI functions.

#### Acceptance Criteria

- `cargo build --release` in `lib/` succeeds with zero errors
- `just build` succeeds
- Calling `getLine(0)` via NAPI returns the first line of the demo text
- Calling `setCursorPos(1, 0)` then `getCursorPos()` returns `{line: 1, ch: 0}`
- Calling `replaceRange("X", 0, 0, 0, 0)` inserts "X" at the start of line 0 and `getLine(0)` reflects the change
- Calling `getLineCount()` returns the number of lines in the buffer

#### Non-Automatable

- Manual smoke test: run `just dev` and verify the TUI still renders and cursor movement still works after the Rust changes

## Bootstrap

No new packages are required. The existing workspace already has:
- `app/` with Bun + TypeScript
- `lib/` with napi-rs + Rust

After moving files, run:
```bash
just build          # rebuild Rust .node binary
tsc --noEmit -p app/tsconfig.json   # type-check
```

## Technical Context

- TypeScript 5.5.3 (from vim-monaco devDependencies) — `app/` uses Bun's bundled TS, no separate tsc install needed; add `typescript` to `app/devDependencies` if `tsc --noEmit` is needed in CI.
- napi-rs 3.8.3 / napi-derive 3.5.2 (from `lib/Cargo.toml`) — no breaking changes relevant here.
- Bun 1.3.9 — runtime for `app/`.
- ratatui 0.30.0, crossterm 0.29.0 — existing Rust deps, no changes needed.
- vim-monaco upstream: commit `cfd0159` (latest as of 2026-03-28), version 1.0.6.

## Notes

- The `digraph.ts` file imports from `./digraph` which is generated by `digraph.src.js`. The generated `digraph.ts` already exists in `vim-monaco/src/` and should be copied as-is — no regeneration needed.
- `keymap_vim.ts` is 2381 lines and imports `PACKAGE_INFO` from `./version`. After removing `build.js`, replace this import with a hardcoded constant: `export const PACKAGE_INFO = { name: "revim", version: "0.0.1" }` in a new `app/src/vim/version.ts`.
- The `TerminalKeyEvent` interface (replacing Monaco's `IKeyboardEvent`) needs: `key: string`, `keyCode: number` (can be 0 for terminal), `ctrlKey: boolean`, `altKey: boolean`, `shiftKey: boolean`, `metaKey: boolean`. The `getEventKeyName` function in `common.ts` should be simplified to just return `e.key` with modifier prefixes — terminal key events don't use Monaco keycodes.
- `EditorAdapter.commands` static map has `redo`, `undo`, `newlineAndIndent` — these map to `triggerAction` in Rust. The `open` and `save` commands are registered in `VimMode.initListeners()` and remain there.
- The `ctxInsert` context key (Monaco-specific) in `EditorAdapter` has no terminal equivalent — replace with a plain boolean field `insertMode: boolean` on `TerminalAdapter`.
- `replaceMode` and `replaceStack` in `EditorAdapter` are pure TypeScript state — copy verbatim to `TerminalAdapter`.
- `handleReplaceMode` in `EditorAdapter` handles keyboard events directly — in `TerminalAdapter` this becomes a method called from `VimMode` when a key arrives from the terminal keyboard listener.
