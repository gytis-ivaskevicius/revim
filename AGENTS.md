# AGENTS

## Project setup

- **Runtime**: `bun` (not node/npm)
- **TypeScript compilation**: no explicit build step — Bun runs `.ts` files directly
- **Native addon**: Rust-based N-API addon at `lib/` (requires `cargo` to build; auto-built by workspace)

## Code map

- `app/src/index.ts` — app entry, async keyboard event loop, shutdown path
- `app/src/terminal-key.ts` — terminal key normalization/encoding boundary
- `app/src/vim/` — Vim layer port; start with:
  - `keymap_vim.ts` — adapter bootstrap, key translation, selection syncing
  - `command-dispatcher.ts` — motion/operator orchestration
  - `motions.ts`, `operators.ts` — core motion/operator behavior
  - `motion-paragraph.ts` — paragraph/sentence motions for `{`, `}`, `(`, `)`
  - `default-key-map.ts` — Vim keybinding table
  - `ex-commands.ts` — Ex command parsing, execution, and `:s///c` confirm prompt handler
- `app/src/log.ts` — logging API (initLog, log); wire `--log <path>` in index.ts
- `lib/src/tui/log.rs` — Rust logging (setLogFd, appendLog, revim_log! macro)
- `lib/src/tui/api.rs` — N-API boundary for cursor, buffer, keyboard listener (queue + condvar)
- `lib/src/tui/state.rs` — demo buffer, cursor state, clipping rules
- `lib/src/tui/render.rs` — terminal rendering and cursor placement
- `app/tests/e2e/` — terminal E2E suite; `test-utils.ts` sets shared config
- `app/tests/unit/` — unit tests (run via `bun test`)

## How to run

All commands use `just` (see [Justfile](./Justfile)):

```sh
# Build native addon (Rust N-API)
just build

# Development (builds then runs app)
just dev

# Development with logging
just dev -- --log /tmp/revim.log
```

## How to test

```sh
# TypeScript unit tests
just test-unit

# E2E tests (requires @microsoft/tui-test; also builds native addon)
just test-e2e

# Rust unit tests
just test-rust

# All tests
just test
```

## How to lint

```sh
# Lint everything (tsc + clippy + biome)
just lint

# Auto-fix lint issues
just lint-fix
```

## How to typecheck

```sh
just lint       # includes tsc --noEmit
# Or directly:
npx tsc --noEmit
```

## Workspace packages

- **New workspace packages require explicit dependency in `app/package.json`**: When you add a new package under `packages/` and add `"packages/*"` to the root workspace array, Bun creates the workspace content in `node_modules/@revim/` only for packages listed as dependencies. For `tsc --noEmit` (and thus `just lint`) to resolve `@revim/<name>`, add `"@revim/<name>": "workspace:*"` to `app/package.json` dependencies and run `bun install`. This mirrors how `@revim/lib` is already listed.

## Gotchas

- `@microsoft/tui-test` `getByText()` only accepts `string` and `RegExp` — never pass a function (gets `.toString()`'d and never matches). Regex patterns must include the `g` flag or `matchAll` throws a TypeError. If a short string like `":"` matches too many elements on screen, type more characters and match a longer combined string like `getByText(":a")`.
- For visual/block selection bugs, inspect TS selection shaping and Rust application together.
- `@microsoft/tui-test` can fail on transient Cargo dirs under `lib/target` during cache copy.
- `@microsoft/tui-test` can also flake when worker reuse is too aggressive; if the suite starts from a blank `>` prompt or tests contaminate each other, inspect `tui-test.config.ts` worker count before assuming an app regression.
- **E2E tests: use Vim motions, not repeated key presses**. Prefer `G`, `gg`, `0`, `$`, `/pattern` over repeated ArrowUp/ArrowDown/ArrowLeft/ArrowRight — they're faster, less timing-sensitive, and test the actual editing interface.
- **Mutex deadlock in NAPI functions**: `render_frame_internal()` acquires `TUI_CONTEXT.lock()`. Any NAPI function that holds `TUI_CONTEXT.lock()` or `state.lock()` must drop those locks with a `{ }` block BEFORE calling `render_frame_internal()`. `std::sync::Mutex` is not reentrant — calling it while already held deadlocks the JS thread, freezing all keyboard input. Audit all `render_frame_internal()` call sites for this pattern. To isolate, comment out NAPI calls in the suspect operation one by one until input resumes.
- **Keyboard input uses queue + async pull**: The keyboard listener pushes events to a `Mutex<VecDeque>` + `Condvar` from a Rust thread. TypeScript calls `await waitForKeyboardEvent()` in a loop to pull events. Do NOT revert to `ThreadsafeFunction` callback approach — it was the original mechanism but was replaced due to the deadlock issue above (the callback appeared to stop working when the JS thread deadlocked).
- **Prompt closing uses return-value pattern**: `onKeyDown` receives `(evt, text, setQuery)` where `setQuery` updates the query text. The prompt is closed when `onKeyDown` returns `true`. This replaced the old `close(value?)` callback to avoid ambiguous overloading (`close()` vs `close("")`).
- **`ex-commands.ts` has its own `onPromptKeyDown`**: The `doReplace` function in `ex-commands.ts` uses the status bar prompt for `:s///c` confirm/reject. If you change the `StatusBarInputOptions.onKeyDown` callback signature, update this handler too. It's the only prompt caller outside `command-dispatcher.ts`.
- **Ctrl-C is intercepted at the event loop, not prompt handlers**: `app/src/index.ts:69-72` catches Ctrl-C at the main event loop and calls `shutdown(0)`. Ctrl-C never reaches prompt handlers or the Vim key handler. Do not write E2E tests expecting Ctrl-C to close a prompt — use Esc instead. Also, `encodeTerminalKey` normalizes Ctrl characters to lowercase, so checks like `keyName === "Ctrl-C"` (uppercase) in prompt handlers are dead code — they never match.
- **`@microsoft/tui-test` `testMatch` must be scoped to e2e/**: `testIgnore` in `tui-test.config.ts` prevents unit tests from *running* but does not prevent the framework from *transpiling* them (which can crash on ESM resolution). Always scope `testMatch` to `app/tests/e2e/**/*.test.ts` — do not rely on `testIgnore` alone.
- **NAPI-RS type declarations are auto-generated**: `lib/index.d.ts` is generated by `napi build` (run via `just build`). After adding a new `#[napi]` function in Rust, you must rebuild — otherwise `tsc --noEmit` fails with "Module has no exported member". Run `just build` before `just lint` after any NAPI changes.
