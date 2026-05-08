# Extract lib-independent code from adapter.ts

## Context

`app/src/vim/adapter.ts` is a 900-line file that mixes pure TypeScript types, constants, and utility logic with code that directly calls `@revim/lib` (the Rust N-api addon). This coupling makes it impossible to unit-test the vim logic without the native addon, and obscures which parts of the adapter truly depend on the Rust layer. We need to separate the lib-independent code into dedicated files so that `adapter.ts` contains only code that explicitly imports or calls `@revim/lib`.

## Out of Scope

- Changing the `EditorAdapter` public API — all existing call sites must continue to work without modification.
- Changing the `@revim/lib` Rust surface.
- Refactoring other vim files that import from `adapter.ts` (they will import from the new files instead, or from re-exports in `adapter.ts`).
- Extracting `addOverlay` / `removeOverlay` / `highlightRanges` — these call `setHighlights()` from `@revim/lib` and the regex matching is inline; not worth extracting.

## Implementation approach

### New files

1. **`app/src/vim/adapter-types.ts`** — Zero dependency on `@revim/lib`. Contains:
   - `CmSelection` class (pure data: anchor/head positions, `from()`, `empty()`). Imports `type Pos` from `./common`.
   - `BindingFunction`, `CallFunction`, `Binding` type aliases
   - `KeyMapEntry` interface
   - `Change` interface
   - `Operation` interface
   - `ExCommandOptionalParameters` interface

2. **`app/src/vim/adapter-search.ts`** — Zero dependency on `@revim/lib`. Contains:
   - `LineAccessor` interface: `{ getLine(line: number): string; lineCount(): number }`
   - `MatchingBracket` interface
   - `kMatchingBrackets` constant
   - `escapeRegex(str: string): string` — extracted from `EditorAdapter.escapeRegex`
   - `scanForBracket(accessor: LineAccessor, pos: Pos, dir: number, bracketRegex: RegExp, openChar?: string, closeChar?: string): { pos: Pos } | undefined` — extracted from `EditorAdapter.scanForBracket`
   - `findMatchingBracket(accessor: LineAccessor, cur: Pos): { pos: Pos } | undefined` — extracted from `EditorAdapter.findMatchingBracket`
   - `SearchMatch` interface: `{ line: number; ch: number; endLine: number; endCh: number }`
   - `SearchCursor` interface: `{ findNext(): boolean; findPrevious(): boolean; jumpTo(index: number): Pos | false; find(back: boolean): boolean; from(): Pos | undefined; to(): Pos | undefined; replace(text: string): void; getMatches(): SearchMatch[] }`
   - `createSearchCursor(accessor: LineAccessor, pattern: string | RegExp, startPos: Pos, replaceFn: (text: string, from: Pos, to: Pos) => void): SearchCursor` — extracted from `EditorAdapter.getSearchCursor`. The `replaceFn` callback decouples the `replace()` method from `@revim/lib`; `EditorAdapter` passes `(text, from, to) => this.replaceRange(text, from, to)`.

### Modified file

3. **`app/src/vim/adapter.ts`** — Slimmed down. Changes:
   - Remove all types/interfaces/constants that moved to `adapter-types.ts`
   - Remove `kMatchingBrackets`, `MatchingBracket`, `escapeRegex` that moved to `adapter-search.ts`
   - Import `findMatchingBracket`, `scanForBracket`, `createSearchCursor`, `escapeRegex` from `./adapter-search`
   - Import `CmSelection`, `KeyMapEntry`, `Change`, `BindingFunction`, `CallFunction`, `Binding`, `Operation`, `ExCommandOptionalParameters` from `./adapter-types`
   - Re-export from `adapter.ts` so existing import sites don't break: `export { CmSelection } from "./adapter-types"` and `export type { KeyMapEntry, Change, BindingFunction, ExCommandOptionalParameters } from "./adapter-types"` and `export type { MatchingBracket, SearchCursor, SearchMatch } from "./adapter-search"`
   - Replace `findMatchingBracket`, `scanForBracket`, `getSearchCursor` method bodies with thin delegates:
     - `findMatchingBracket(cur: Pos) { return findMatchingBracket(this, cur) }`
     - `scanForBracket(pos, dir, bracketRegex, openChar?, closeChar?) { return scanForBracket(this, pos, dir, bracketRegex, openChar, closeChar) }`
     - `getSearchCursor(pattern, startPos) { return createSearchCursor(this, pattern, startPos, (text, from, to) => this.replaceRange(text, from, to)) }`
   - Remove private `escapeRegex` method (now a standalone function imported from `adapter-search.ts`)
   - `EditorAdapter` implicitly satisfies `LineAccessor` (duck typing — it has `getLine` and `lineCount` methods)
   - `Marker` class stays in `adapter.ts` because it references `EditorAdapter` directly and mutates `adapter.marks`

### Import site updates

All files that currently import types from `./adapter` will continue to work because `adapter.ts` re-exports them. No import site changes required. The following files import named exports from `./adapter` and will work unchanged via re-exports:

- `types.ts` — imports `CmSelection`, `Marker` from `./adapter`
- `insert-mode.ts` — imports `BindingFunction`, `Change` from `./adapter`
- `keymap_vim.ts` — imports `CmSelection`, `KeyMapEntry` from `./adapter`
- `operators.ts` — imports `CmSelection` from `./adapter`
- `vim-utils.ts` — imports `CmSelection` from `./adapter`
- `jump-list.ts` — imports `Marker` from `./adapter`
- `command-dispatcher.ts` — imports `CmSelection` from `./adapter`
- `actions.ts` — imports `CmSelection` from `./adapter`

## Tasks

### Task 1 — Create `adapter-types.ts` with extracted types and `CmSelection`

- Create `app/src/vim/adapter-types.ts` containing: `CmSelection` class, `BindingFunction`, `CallFunction`, `Binding` type aliases, `KeyMapEntry` interface, `Change` interface, `Operation` interface, `ExCommandOptionalParameters` interface
- `CmSelection` imports `type Pos` from `./common` (used in field type annotations)
- `CmSelection.from()` uses inline comparison logic (no `cursorMin` dependency)
- `CmSelection.empty()` uses inline equality check
- Verify: `npx tsc --noEmit` passes after Task 3 is also complete

### Task 2 — Create `adapter-search.ts` with extracted search/bracket logic

- Create `app/src/vim/adapter-search.ts` containing: `LineAccessor` interface, `MatchingBracket` interface, `kMatchingBrackets` constant, `escapeRegex`, `scanForBracket`, `findMatchingBracket`, `SearchMatch` interface, `SearchCursor` interface, `createSearchCursor`
- `findMatchingBracket` imports `kMatchingBrackets` and `MatchingBracket` from same file, and `makePos` from `./common`
- `createSearchCursor` imports `makePos` from `./common` and `escapeRegex` from same file
- All functions take `LineAccessor` as first argument instead of using `this`
- `createSearchCursor` takes a `replaceFn: (text: string, from: Pos, to: Pos) => void` callback so `SearchCursor.replace()` is decoupled from `@revim/lib`
- Verify: `npx tsc --noEmit` passes after Task 3 is also complete

### Task 3 — Slim down `adapter.ts` to delegate to extracted modules

- Remove type/interface/constant definitions that moved to `adapter-types.ts`
- Remove `kMatchingBrackets`, `MatchingBracket` constant/interface that moved to `adapter-search.ts`
- Remove private `escapeRegex` method
- Add imports from `./adapter-types` and `./adapter-search`
- Add re-exports: `export { CmSelection } from "./adapter-types"`, `export type { KeyMapEntry, Change, BindingFunction, ExCommandOptionalParameters } from "./adapter-types"`, `export type { MatchingBracket, SearchCursor, SearchMatch } from "./adapter-search"`
- Replace `findMatchingBracket`, `scanForBracket`, `getSearchCursor` method bodies with delegates passing `this` as `LineAccessor`
- `getSearchCursor` delegate passes `(text, from, to) => this.replaceRange(text, from, to)` as `replaceFn`
- Verify: `npx tsc --noEmit` passes

### Task 4 — Verify all existing tests pass

- Run `just lint` (includes `tsc --noEmit` + biome + clippy)
- Run `just test` (all unit + e2e tests)
- All existing E2E tests must pass unchanged — no behavioral changes

## Bootstrap

No new packages required. Existing setup:

```sh
just build
just lint
just test
```

## Technical Context

- No new dependencies — this is a pure refactor extracting existing code into new files within the same package.
- `CmSelection` imports `type Pos` from `./common` — used in field type annotations only.
- `CmSelection.from()` uses inline comparison logic (`this.anchor.line < this.head.line`, etc.) — no dependency on `cursorMin` from `./common`.
- `EditorAdapter` implicitly satisfies the `LineAccessor` interface (has `getLine(line: number): string` and `lineCount(): number`). No explicit `implements` clause needed but it can be added for documentation.
- `SearchCursor.replace()` originally called `context.replaceRange(text, from, to)` where `context` was the `EditorAdapter` instance. In the extracted version, `createSearchCursor` accepts a `replaceFn` callback to preserve this behavior without coupling to `@revim/lib`.

## Notes

- The `Marker` class stays in `adapter.ts` because it directly references `EditorAdapter` (via `adapter.marks`) and is tightly coupled to the adapter instance.
- `EditorAdapter.commands` static property references `adapter.redo()`, `adapter.undo()`, `adapter.undoLine()`, `adapter.triggerEditorAction()` — these are methods on the adapter that call `@revim/lib`. The static property itself doesn't import lib, but the function bodies reference adapter methods that do. It stays in `adapter.ts`.
- `EditorAdapter.lookupKey` static method is pure logic with no lib dependency. It references `KeyMapEntry` (now in `adapter-types.ts`) and is part of the class interface. Leaving it in `adapter.ts` is acceptable since the class still exists there.
- The `Operation` interface is not exported from `adapter.ts` currently (it's private). It moves to `adapter-types.ts` but is not re-exported — it's only used internally by `EditorAdapter`.
- `addOverlay`, `removeOverlay`, and `highlightRanges` stay in `adapter.ts` because they call `setHighlights()` from `@revim/lib`.
- Re-exporting from `adapter.ts` ensures zero import-site changes across the 15+ files that import from it.