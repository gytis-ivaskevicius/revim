# AGENTS

## Project setup

- **Runtime**: `bun` (not node/npm)
- **TypeScript compilation**: no explicit build step — Bun runs `.ts` files directly
- **Native addon**: Rust N-API addon at `packages/core/` (requires `cargo`; auto-built by workspace)

## Codebase navigation

Each package has a `.repomap.md` with a compact symbol map — read it proactively before navigating or editing code in that package.

- [`packages/app/.repomap.md`](packages/app/.repomap.md) — TypeScript entry point: wires the Vim engine to the terminal, owns the event loop, keyboard input, and the error/log windows
- [`packages/core/.repomap.md`](packages/core/.repomap.md) — Rust N-API addon: manages the terminal (raw mode, resize), drives rendering, and exposes NAPI bindings consumed by `packages/app`
- [`packages/vim/.repomap.md`](packages/vim/.repomap.md) — Vim engine: modes (normal/insert/visual/ex), motions, operators, registers, macros, search, and jump list; adapter interface decouples it from the terminal

Regenerate with `just gen-context`.

## Commands

All commands use `just` (see [Justfile](./Justfile)):

```sh
just build        # build native addon
just dev          # build + run app
just dev -- --log /tmp/revim.log

just test         # all tests
just test-unit    # TypeScript unit tests
just test-e2e     # E2E tests (also builds native addon)
just test-rust    # Rust unit tests

just lint         # tsc + clippy + biome
just lint-fix     # auto-fix lint issues — run this before committing; biome catches many style issues

just check        # test + lint
```

> `just lint` includes `tsc --noEmit`. To run tsc directly: `cd packages/app && bunx tsc --noEmit`

## Gotchas

- **`getByText()` quirks**: only accepts `string` or `RegExp` (functions get `.toString()`'d and never match). Regex must include the `g` flag or `matchAll` throws. If a short string matches too many elements, match a longer one (e.g. `getByText(":a")` instead of `getByText(":")`).
- **tui-test flake**: can fail on transient Cargo dirs under `packages/core/target` during cache copy.
- **E2E tests: use Vim motions** (`G`, `gg`, `0`, `$`, `/pattern`) over repeated arrow keys — faster, less timing-sensitive, tests the actual interface.
- **Mutex deadlock**: `render_frame_internal()` acquires `TUI_CONTEXT.lock()`. Any NAPI function holding `TUI_CONTEXT.lock()` or `state.lock()` must drop those locks in a `{ }` block before calling `render_frame_internal()`. `std::sync::Mutex` is not reentrant — holding it deadlocks the JS thread and freezes keyboard input. Audit all `render_frame_internal()` call sites for this pattern. To isolate, comment out NAPI calls one by one until input resumes.
- **Ctrl-C is intercepted at the event loop** (`index.ts:69-72`) and calls `shutdown(0)` — it never reaches prompt handlers or the Vim key handler. Use Esc in E2E tests, not Ctrl-C. Also, `encodeTerminalKey` lowercases Ctrl combos, so `keyName === "Ctrl-C"` (uppercase) in handlers is dead code.
- **NAPI-RS declarations are auto-generated**: `packages/core/index.d.ts` is produced by `napi build`. After adding a `#[napi]` function, run `just build` before `just lint` or `tsc --noEmit` will fail with "Module has no exported member".
