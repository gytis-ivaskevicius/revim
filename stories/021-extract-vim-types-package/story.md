# Extract generic Vim types into `@revim/vim-keybindings` package

## Context

The vim layer in `app/src/vim/` contains generic types (`Pos`, `CmSelection`, keybinding types, etc.) and utility classes (`StringStream`) that have no dependency on `@revim/lib` or the terminal UI. Extracting these into a standalone Bun workspace package is the first step toward making the vim logic reusable and free of N-API addon coupling. This story only creates the package, moves the generic code, and updates imports — no runtime behavior changes.

The package must have **zero imports into the app directory** (no `import` or `import type` pointing at `@revim/app` or relative paths back to `app/`). Any type that references an app-internal type (`EditorAdapter`, `Marker`, `InputState`, `MotionFunc`, `SearchState`, `BindingFunction`, `LastSelection`, `VimState`, `Context`, `OperatorArgs`, or any `KeyMapping*` type) stays in the app.

## Out of Scope

- Moving `EditorAdapter` class or `Marker` class (`Marker` directly references `EditorAdapter.marks`; it stays in `adapter.ts` until an interface is extracted).
- Moving `statusbar.ts`, `terminal-status-bar.ts`, or any file that depends on `@revim/lib`.
- Moving `app/src/vim/input-state.ts`, `motions.ts`, `search.ts` and their types (`InputState`, `MotionFunc`, `SearchState`).
- Moving `app/src/vim/index.ts`.
- Any behavior changes or refactors beyond import path updates.

## Implementation approach

1. **Package scaffolding**
   - Create `packages/vim-keybindings/` with `package.json`, `tsconfig.json`, and `src/index.ts`.
   - Update root `package.json` workspaces to include `"packages/*"`.
   - The package has **zero** dependencies — runtime or type-time — on `@revim/lib` or app modules.

2. **What moves into `packages/vim-keybindings/src/`**
   - **`types.ts`** — contains only standalone types with no app-internal references:
     - Extracted from `app/src/vim/adapter.ts`: `CmSelection`, `Change`, `MatchingBracket`, `kMatchingBrackets`, `ExCommandOptionalParameters`.
     - Extracted from `app/src/vim/types.ts`: `VimOptions`, `MotionArgs`, `ActionArgs`, `SearchArgs`, `OperatorMotionArgs`, `ExArgs`, `MappableCommandType`, and all `ExCommand*` types (`ExCommandDefault`, `ExCommandExToEx`, `ExCommandExToKey`, `ExCommandApi`, `ExCommand`).
   - **`common.ts`** — move from `app/src/vim/common.ts` only the Pos-related exports: `Pos`, `isPos`, `makePos`, `copyCursor`, `cursorEqual`, `cursorIsBefore`, `cursorMin`, `cursorMax`, `cursorIsBetween`.
   - **`string-stream.ts`** — move verbatim from `app/src/vim/string-stream.ts`.
   - **`version.ts`** — move verbatim from `app/src/vim/version.ts`.
   - **`index.ts`** — re-export everything from the four modules above.

3. **What stays in the app**
   - `app/src/vim/adapter.ts` keeps `EditorAdapter`, `Marker`, `BindingFunction`, `KeyMapEntry`, and `CallFunction`. `BindingFunction` references `EditorAdapter`, and `KeyMapEntry` references `BindingFunction`; neither can move without an app import. Remove only the extracted type definitions (`CmSelection`, `Change`, `MatchingBracket`, `kMatchingBrackets`, `ExCommandOptionalParameters`) and import them from `@revim/vim-keybindings` instead.
   - `app/src/vim/common.ts` keeps non-Pos utilities: `findFirstNonWhiteSpaceCharacter`, `isLowerCase`, `isMatchableSymbol`, `isNumber`, `isUpperCase`, `isWhiteSpaceString`, `isEndOfSentenceSymbol`, `inArray`, `TerminalKeyEvent`, `stopEvent`, `getEventKeyName`.
   - `app/src/vim/types.ts` keeps app-referencing types: `LastSelection`, `VimState`, `Context`, `OperatorArgs`, `MappableArgType`, `KeyMappingDefault`, and all `KeyMapping*` / `KeyMapping` union types. Remove only the types that moved to the package and import them from `@revim/vim-keybindings`.

4. **Import path updates**
   - Files importing `CmSelection`, `Change`, `MatchingBracket`, `kMatchingBrackets`, or `ExCommandOptionalParameters` from `./adapter` → import from `@revim/vim-keybindings`.
   - Files importing `MotionArgs`, `ActionArgs`, `SearchArgs`, `OperatorMotionArgs`, `ExArgs`, `VimOptions`, `MappableCommandType`, or `ExCommand*` types from `./types` → import from `@revim/vim-keybindings`.
   - Files importing Pos utilities from `./common` → import those from `@revim/vim-keybindings`; keep non-Pos imports from `./common`.
   - Files importing `./string-stream` → import from `@revim/vim-keybindings`.
   - Files importing `./version` → import from `@revim/vim-keybindings`.
   - `Marker` imports remain pointing to `./adapter` since `Marker` was not extracted.
   - `BindingFunction` and `KeyMapEntry` imports remain pointing to `./adapter` since they were not extracted.

## Tasks

### Task 1 — Scaffold package and extract types

#### Acceptance Criteria

- root `package.json` workspaces array includes `"packages/*"`
  - → `bun` resolves `@revim/vim-keybindings` as a workspace package
- `packages/vim-keybindings/package.json` exists with `"name": "@revim/vim-keybindings"`
- `packages/vim-keybindings/tsconfig.json` exists with `moduleResolution: "bundler"` and `strict: true`
  - → `npx tsc --noEmit` inside `packages/vim-keybindings/` succeeds
- `packages/vim-keybindings/src/index.ts` re-exports all four modules
  - → consumers can use `import { ... } from "@revim/vim-keybindings"`
- `packages/vim-keybindings/src/types.ts` contains exactly the standalone types listed in the Implementation Approach
  - → `grep -r "export class CmSelection" packages/vim-keybindings/src/types.ts` matches
  - → `grep -r "export interface MotionArgs" packages/vim-keybindings/src/types.ts` matches
  - → `grep -r "export interface VimState\|export interface LastSelection\|export type Context\|export interface KeyMapEntry\|export type BindingFunction" packages/vim-keybindings/src/types.ts` returns empty
- `packages/vim-keybindings/src/common.ts` contains exactly the Pos-related utilities listed
  - → no `TerminalKeyEvent` or `stopEvent` remains in the package's `common.ts`
- `packages/vim-keybindings/src/string-stream.ts` and `packages/vim-keybindings/src/version.ts` exist
- `packages/vim-keybindings/src/` contains zero imports pointing into the app
  - → `grep -rn 'from "\.\./\.\./app\|from "@revim/app' packages/vim-keybindings/src/` returns empty
- `app/src/vim/types.ts` still exists and contains app-referencing types (`LastSelection`, `VimState`, `Context`, `OperatorArgs`, `KeyMappingDefault`, all `KeyMapping*` types)
  - → file is not deleted
- `app/src/vim/common.ts` no longer contains Pos-related exports
  - → `grep "export interface Pos" app/src/vim/common.ts` returns empty
- `app/src/vim/adapter.ts` no longer defines `CmSelection`, `Change`, `MatchingBracket`, `kMatchingBrackets`, `ExCommandOptionalParameters`
  - → each of those identifiers is imported from `@revim/vim-keybindings` instead
- `Marker`, `BindingFunction`, `KeyMapEntry` remain defined in `app/src/vim/adapter.ts`
  - → `grep "export class Marker\|export type BindingFunction\|export interface KeyMapEntry" app/src/vim/adapter.ts` matches

### Task 2 — Update import paths across the vim layer

#### Acceptance Criteria

- Every file under `app/src/vim/` that previously imported `CmSelection`, `Change`, `MatchingBracket`, `kMatchingBrackets`, or `ExCommandOptionalParameters` from `./adapter` now imports them from `@revim/vim-keybindings`
  - → `grep -rn 'from "\./adapter"' app/src/vim/ | grep -E 'CmSelection|Change|MatchingBracket|kMatchingBrackets|ExCommandOptionalParameters'` returns empty
- Every file under `app/src/vim/` that previously imported moved types from `./types` now imports them from `@revim/vim-keybindings`
  - → `grep -rn 'from "\./types"' app/src/vim/` no longer references moved types (e.g. `MotionArgs`, `ActionArgs`, `ExArgs`, `VimOptions`, `ExCommand`)
- Every file under `app/src/vim/` that previously imported Pos utilities from `./common` now imports them from `@revim/vim-keybindings`
  - → `grep -rn 'makePos\|cursorEqual\|cursorMin\|cursorMax\|copyCursor\|cursorIsBefore\|cursorIsBetween\|isPos' app/src/vim/common.ts` returns empty
- Every file under `app/src/vim/` that previously imported from `./string-stream` now imports from `@revim/vim-keybindings`
  - → `grep -rn 'from "\./string-stream"' app/src/vim/` returns empty
- `app/src/vim/ex-commands.ts` imports `PACKAGE_INFO` from `@revim/vim-keybindings`
  - → `grep 'from "@revim/vim-keybindings".*PACKAGE_INFO\|from "\./version"' app/src/vim/ex-commands.ts` shows only the package import
- Files that import both Pos and non-Pos utilities use two import statements (one from `@revim/vim-keybindings`, one from `./common`)
  - → e.g. `command-dispatcher.ts`, `motions.ts`, `ex-commands.ts`, `keymap_vim.ts`, `actions.ts`

### Task 3 — Verify no regressions

#### Acceptance Criteria

- `just lint` exits with code 0
  - → `tsc --noEmit` passes for the entire workspace
  - → biome passes
- `just test-unit` exits with code 0
  - → all existing unit tests pass
- `just test-e2e` exits with code 0 (or is run and passes)
  - → no E2E regressions from import path changes

## Bootstrap

```sh
# 1. Ensure package directory exists
mkdir -p packages/vim-keybindings/src

# 2. Bun will auto-discover the new workspace package after updating root package.json
# 3. No additional dependency installs are required (package has zero runtime deps)
```

## Technical Context

- Bun workspace: packages are discovered from root `package.json` `workspaces` array. The new package must be listed (or a glob like `packages/*` must match its directory).
- TypeScript `moduleResolution: "bundler"` (used by both app and new package) supports `exports` maps and bare-specifier subpath imports.
- `BindingFunction` stays in `app/src/vim/adapter.ts` because its signature includes `EditorAdapter`. `KeyMapEntry` stays in `app/src/vim/adapter.ts` because it references `BindingFunction`. Both will be extracted in a later story after an `IEditorAdapter` interface is introduced.
- `Marker` class: intentionally kept in `adapter.ts` because its constructor side-effects (`adapter.marks.set(...)`) depend on `EditorAdapter` instance state.
- `OperatorArgs` stays in `app/src/vim/types.ts` because it references `LastSelection` (which references `Marker`). Consequently all `KeyMapping*` types that extend `KeyMappingDefault` (which references `Context`) also stay in the app.

## Notes

- Do not change any runtime logic; this is a pure move-and-rename refactor.
- After moving files, ensure no stale `.d.ts` or cache artifacts remain (Bun's TypeScript cache can occasionally hold deleted files; `bun pm cache rm` is rarely needed but may help if resolution seems wrong).
