# NAPI-RS FFI POC

## Context

We are building a vim editor in Rust + TypeScript. The architecture uses a tiny Rust library for UI rendering (ratatui), loaded by Bun runtime for performance. Before implementing the full TUI, we need a proof-of-concept demonstrating FFI interaction between TypeScript (Bun) and Rust via NAPI-RS.

This POC validates:
1. TypeScript can call Rust functions synchronously and asynchronously
2. Rust can emit events that TypeScript subscribes to via callbacks
3. The build pipeline works for development and production

## Out of Scope

- TUI rendering (ratatui integration)
- Vim-specific functionality (buffers, windows, commands)
- Production-ready error handling
- Cross-platform binary builds (CI/CD)
- Performance benchmarking

## Implementation approach

### Project Structure

```
revim/
├── lib/                    # Rust NAPI library
│   ├── src/
│   │   └── lib.rs          # NAPI bindings
│   ├── Cargo.toml
│   └── package.json        # For @napi-rs/cli
├── app/                    # Bun/TypeScript application
│   ├── src/
│   │   └── index.ts        # Demo script
│   ├── package.json
│   └── tsconfig.json
└── package.json            # Workspace root
```

### NAPI-RS Patterns

**Sync function calls:**
- Use `#[napi]` macro to expose Rust functions
- TypeScript calls directly, receives return value

**Async function calls:**
- Use `#[napi]` with `async fn` (requires `tokio_rt` feature)
- Returns Promise from TypeScript perspective

**Event subscriptions (Rust → TS):**
- Use `ThreadsafeFunction<T>` for cross-thread callbacks
- TypeScript passes a callback function
- Rust stores it and calls from background threads
- Supports both blocking and non-blocking call modes

### Key Technical Decisions

1. **NAPI-RS version 3.x** - Latest stable with Bun support
2. **Tokio runtime** - Required for async fn support
3. **ThreadsafeFunction** - Enables Rust→TS events from any thread
4. **Workspace structure** - Separate lib/ and app/ directories

## Tasks

### Task 1 - Justfile Setup

#### Acceptance Criteria

- `just --list` shows all available commands
- `just build` compiles Rust library and generates `.node` binary
- `just dev` runs the demo script
- `just test` runs all tests (placeholder for POC)
- `just lint` runs all linters (placeholder for POC)
- `just check` runs test and lint together

#### Non-Automatable

- Manual verification: `just --list` shows all commands with descriptions

### Task 2 - Rust NAPI Library Setup

#### Acceptance Criteria

- `lib/` directory exists with Cargo.toml configured for NAPI-RS
- `napi` and `napi-derive` dependencies at version 3.8.3
- `tokio` dependency with `full` features for async support
- `lib/src/lib.rs` exists with basic module structure
- `cargo build` compiles successfully
- `napi build` produces `.node` binary in lib/ directory

#### Non-Automatable

- Manual verification: `ls lib/*.node` shows compiled binary

### Task 3 - Sync Function Implementation

#### Acceptance Criteria

- `#[napi]` function `greet(name: String) -> String` exists
- Returns `"Hello, {name}!"` format
- TypeScript can call `greet("World")` and receive `"Hello, World!"`
- TypeScript type definitions generated automatically

#### Non-Automatable

- Manual verification: running demo script shows correct output

### Task 4 - Async Function Implementation

#### Acceptance Criteria

- `#[napi]` async function `fetch_data(id: u32) -> Result<String>` exists
- Simulates async work with `tokio::time::sleep`
- Returns `Data for ID {id}` after ~100ms delay
- TypeScript can `await fetch_data(42)` and receive result
- TypeScript type definitions show `Promise<string>` return type

#### Non-Automatable

- Manual verification: demo script shows async timing and result

### Task 5 - Event Emitter (ThreadsafeFunction)

#### Acceptance Criteria

- `#[napi]` function `start_counter(callback: ThreadsafeFunction<u32>)` exists
- Spawns background thread that emits numbers 0-4 with 500ms intervals
- TypeScript callback receives each number: `(err, value) => void`
- `err` is null on success, contains Error on failure
- TypeScript can subscribe and receive all 5 events in sequence

#### Non-Automatable

- Manual verification: demo script shows events arriving in order with timing

### Task 6 - Bun Application Setup

#### Acceptance Criteria

- `app/` directory with package.json and tsconfig.json
- Bun 1.3.x as runtime
- TypeScript strict mode enabled
- `lib/` imported as workspace dependency
- `bun run src/index.ts` executes demo script

#### Non-Automatable

- Manual verification: `bun run src/index.ts` runs without errors

### Task 7 - Demo Script

#### Acceptance Criteria

- `app/src/index.ts` demonstrates all FFI patterns:
  1. Sync call: `greet("Bun")` → logs result
  2. Async call: `await fetch_data(1)` → logs result with timing
  3. Event subscription: `start_counter(callback)` → logs each event
- Script exits cleanly after all events received
- Output clearly shows which pattern is being demonstrated

#### Non-Automatable

- Manual verification: running script shows all patterns working

## Bootstrap

```bash
# Install just (if not installed)
# macOS: brew install just
# Linux: cargo install just

# Install NAPI-RS CLI globally
npm install -g @napi-rs/cli

# Install dependencies
cd lib && cargo build
cd ../app && bun install

# Build and run
just build
just dev

# Run all checks
just check
```

The Justfile serves as the repo entrypoint for all commands.

## Technical Context

- **@napi-rs/cli**: 3.5.1 - scaffolding and build tooling
- **napi crate**: 3.8.3 - Rust N-API bindings
- **napi-derive crate**: 3.8.3 - procedural macros for #[napi]
- **napi-build crate**: 3.8.3 - build script support
- **tokio**: 1.x - async runtime (full features for POC)
- **Bun**: 1.3.9 (local) / 1.3.11 (latest) - TypeScript runtime
- **TypeScript**: 5.x - type safety

NAPI-RS v3 is stable with no breaking changes relevant to this POC. Bun supports Node.js N-API fully.

## Notes

- ThreadsafeFunction uses "callee-handled" error strategy by default (error passed as first callback argument)
- For production, consider `max_queue_size` to prevent memory exhaustion
- Weak references (`weak::<true>()`) prevent ThreadsafeFunction from keeping process alive
- The `.node` binary is platform-specific; cross-compilation is out of scope for POC

## Data model

Not applicable - POC has no persistent data.

## Contracts

### Rust Library API

```rust
// Sync function
#[napi]
fn greet(name: String) -> String

// Async function
#[napi]
async fn fetch_data(id: u32) -> Result<String>

// Event emitter
#[napi]
fn start_counter(callback: ThreadsafeFunction<u32>)
```

### TypeScript Interface (generated)

```typescript
export function greet(name: string): string
export function fetchData(id: number): Promise<string>
export function startCounter(callback: (err: Error | null, value: number) => void): void
```