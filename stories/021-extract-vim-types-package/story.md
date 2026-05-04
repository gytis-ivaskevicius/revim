# Extract generic Vim types into `@revim/vim-keybindings` package

## Context

The vim layer in `app/src/vim/` contains generic types (`Pos`, `CmSelection`, keybinding types, etc.) and utility classes (`StringStream`) that have no dependency on `@revim/lib` or the terminal UI. Extracting these into a standalone Bun workspace package is the first step toward making the vim logic reusable and free of N-API addon coupling. This story only creates the package, moves the generic code, and updates imports — no runtime behavior changes.

## Out of Scope

- Moving `EditorAdapter` class or `Marker` class (`Marker` directly references `EditorAdapter.marks`; it stays in `adapter.ts` until an interface is extracted).
- Moving `statusbar.ts`, `terminal-status-bar.ts`, or any file that depends on `@revim/lib`.
- Moving `app/src/vim/input-state.ts`, `motions.ts`, `search.ts` and their types (`InputState`, `MotionFunc`, `SearchState`). These remain in the app; the package imports them temporarily via `import type`.
- Moving `app/src/vim/index.ts`.
- Any behavior changes or refactors beyond import path updates.

## Implementation approach

1. **Package scaffolding**
   - Create `packages/vim-keybindings/` with `package.json`, `tsconfig.json`, and `src/index.ts`.
   - Update root `package.json` workspaces to include `"packages/*"`.
   - The package has **zero** runtime dependencies on `@revim/lib` or app modules. Temporary `import type` references to app modules are erased at compile time.

2. **What moves into `packages/vim-keybindings/src/`**
   - **`types.ts`** — contains:
     - Extracted from `app/src/vim/adapter.ts`: `CmSelection`, `BindingFunction`, `KeyMapEntry`, `Change`, `MatchingBracket`, `kMatchingBrackets`, `ExCommandOptionalParameters`.
     - Moved from `app/src/vim/types.ts`: `VimOptions`, `LastSelection`, `VimState`, `MotionArgs`, `ActionArgs`, `OperatorArgs`, `SearchArgs`, `OperatorMotionArgs`, `ExArgs`, `Context`, `MappableCommandType`, `MappableArgType`, and all `KeyMapping*` / `ExCommand*` types.
     - `BindingFunction` references `EditorAdapter`; use `import type EditorAdapter from "@revim/app/src/vim/adapter"`.
     - `LastSelection` and `VimState` reference `Marker`; use `import type { Marker } from "@revim/app/src/vim/adapter"`.
     - `VimState` references `InputState`, `MotionFunc`, `SearchState`; use `import type` from their current app locations (`@revim/app/src/vim/input-state`, `@revim/app/src/vim/motions`, `@revim/app/src/vim/search`).
   - **`common.ts`** — move from `app/src/vim/common.ts` only the Pos-related exports: `Pos`, `isPos`, `makePos`, `copyCursor`, `cursorEqual`, `cursorIsBefore`, `cursorMin`, `cursorMax`, `cursorIsBetween`.
   - **`string-stream.ts`** — move verbatim from `app/src/vim/string-stream.ts`.
   - **`version.ts`** — move verbatim from `app/src/vim/version.ts`.
   - **`index.ts`** — re-export everything from the four modules above.

3. **What stays in the app**
   - `app/src/vim/adapter.ts` keeps `EditorAdapter`, `Marker`, and all N-API/Rust imports. Remove the extracted type definitions and import them from `@revim/vim-keybindings` instead.
   - `app/src/vim/common.ts` keeps non-Pos utilities: `findFirstNonWhiteSpaceCharacter`, `isLowerCase`, `isMatchableSymbol`, `isNumber`, `isUpperCase`, `isWhiteSpaceString`, `isEndOfSentenceSymbol`, `inArray`, `TerminalKeyEvent`, `stopEvent`, `getEventKeyName`.
   - `app/src/vim/types.ts` is deleted after its content is moved to the package.

4. **Import path updates**
   - Files importing `./types` → import from `@revim/vim-keybindings`.
   - Files importing Pos utilities from `./common` → import those from `@revim/vim-keybindings`; keep non-Pos imports from `./common`.
   - Files importing `./string-stream` → import from `@revim/vim-keybindings`.
   - Files importing `./version` → import from `@revim/vim-keybindings`.
   - Files importing `CmSelection`, `KeyMapEntry`, `BindingFunction`, `Change`, `ExCommandOptionalParameters`, `MatchingBracket`, or `kMatchingBrackets` from `./adapter` → import from `@revim/vim-keybindings`.
   - `Marker` imports remain pointing to `./adapter` since `Marker` was not extracted.

## Tasks

### Task 1 — Scaffold package and extract types

#### Acceptance Criteria

- root `package.json` workspaces array includes `"packages/*"`
  - → `bun` resolves `@revim/vim-keybindings` as a workspace package
- `packages/vim-keybindings/package.json` exists with `"name": "@revim/vim-keybindings"`
  - → `npm view @revim/vim-keybindings version` is not needed (workspace-only package)
- `packages/vim-keybindings/tsconfig.json` exists with `moduleResolution: "bundler"` and `strict: true`
  - → `npx tsc --noEmit` inside `packages/vim-keybindings/` succeeds
- `packages/vim-keybindings/src/index.ts` re-exports all four modules
  - → consumers can use `import { ... } from "@revim/vim-keybindings"`
- `packages/vim-keybindings/src/types.ts` contains all types listed in the Implementation Approach
  - → `grep -r "export class CmSelection" packages/vim-keybindings/src/types.ts` matches
  - → `grep -r "export interface VimState" packages/vim-keybindings/src/types.ts` matches
- `packages/vim-keybindings/src/common.ts` contains exactly the Pos-related utilities listed
  - → no `TerminalKeyEvent` or `stopEvent` remains in the package's `common.ts`
- `packages/vim-keybindings/src/string-stream.ts` and `packages/vim-keybindings/src/version.ts` exist
  - → content is identical to the original app files (modulo import updates)
- `app/src/vim/types.ts` is deleted
  - → file no longer exists
- `app/src/vim/common.ts` no longer contains Pos-related exports
  - → `grep "export interface Pos" app/src/vim/common.ts` returns empty
- `app/src/vim/adapter.ts` no longer defines `CmSelection`, `KeyMapEntry`, `BindingFunction`, `Change`, `MatchingBracket`, `kMatchingBrackets`, `ExCommandOptionalParameters`
  - → each of those identifiers is imported from `@revim/vim-keybindings` instead
- `Marker` class remains defined in `app/src/vim/adapter.ts`
  - → `grep "export class Marker" app/src/vim/adapter.ts` matches

#### Non-Automatable

- The temporary `import type` from `@revim/app/src/vim/...` in the package is a known intermediate coupling; it will be removed in follow-up stories when the remaining vim files are extracted.

### Task 2 — Update import paths across the vim layer

#### Acceptance Criteria

- Every file under `app/src/vim/` that previously imported from `./types` now imports from `@revim/vim-keybindings`
  - → `grep -rn 'from "\.\./types"\|from "\./types"' app/src/vim/` returns empty (excluding node_modules)
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
- TypeScript `moduleResolution: "bundler"` (used by both app and new package) supports `exports` maps and bare-specifier subpath imports, so `@revim/app/src/vim/adapter` resolves to the TypeScript file directly.
- `import type` is fully erased by TypeScript; it creates no runtime module graph edge, which avoids runtime circular dependencies between `@revim/vim-keybindings` and `@revim/app`.
- Marker class: intentionally kept in `adapter.ts` because its constructor side-effects (`adapter.marks.set(...)`) depend on `EditorAdapter` instance state. Extracting it would require either a generic parameter or an `IEditorAdapter` interface, both of which are out of scope for this story.

## Notes

- Do not change any runtime logic; this is a pure move-and-rename refactor.
- If `just lint` fails due to unresolved `import type` paths from the package into app internals, verify that the path exactly matches the file location (e.g., `@revim/app/src/vim/adapter` for `adapter.ts`).
- After deleting `app/src/vim/types.ts`, ensure no stale `.d.ts` or cache artifacts remain (Bun's TypeScript cache can occasionally hold deleted files; `bun pm cache rm` is rarely needed but may help if resolution seems wrong).
