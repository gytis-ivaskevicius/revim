# Add Basic TUI with Ratatui

## Context

We are building a vim editor in Rust + TypeScript. The architecture uses a tiny Rust library for UI rendering (ratatui), loaded by Bun runtime for performance. The NAPI-RS FFI POC (story 001) validated that TypeScript can call Rust functions and subscribe to events.

This feature adds the first real TUI component: a basic terminal interface with demo text and cursor movement. The cursor movement logic is controlled by TypeScript, demonstrating the event-driven architecture where Rust handles rendering and input capture, while TypeScript handles editor logic.

This validates:
1. Ratatui integration with NAPI-RS
2. Event-driven architecture: Rust captures keyboard events, TypeScript processes them and sends movement commands back
3. Bidirectional communication: TS→Rust (movement commands) and Rust→TS (keyboard events)
4. Basic rendering pipeline

## Out of Scope

- Text editing (insert/delete characters)
- Multiple buffers or windows
- Vim command mode
- Scrolling beyond visible area
- Color themes or styling
- Mouse support
- Performance optimization

## Implementation approach

### Architecture

The TUI follows an event-driven architecture with clear separation of concerns:

1. **Rust (lib/)**: Owns the ratatui Terminal, cursor state, and handles rendering
2. **TypeScript (app/)**: Processes keyboard events and determines movement direction
3. **Communication flow**:
   - Rust captures ALL keyboard events via crossterm
   - Rust sends each event to TypeScript as typed object (not JSON string)
   - TypeScript processes the event and determines movement direction
   - TypeScript calls `move_cursor(direction)` on Rust
   - Rust applies movement with wrapping logic and re-renders frame

**Why this architecture:**
- **Typed objects** eliminate JSON parsing overhead
- **Movement commands** let Rust handle boundaries/wrapping (Rust knows text dimensions)
- **Clear separation**: TypeScript decides *what* to do, Rust knows *how* to do it

### Key Technical Decisions

1. **Ratatui 0.30.0** - Latest stable version with crossterm backend
2. **Crossterm 0.29.0** - Terminal manipulation library (ratatui dependency)
3. **Event-driven loop** - Rust runs the event loop, TypeScript responds to events
4. **State ownership**:
   - Rust: Terminal instance, frame buffer, cursor position (row, col), text boundaries
   - TypeScript: Event processing logic (determines movement direction from keypress)
5. **Typed events** - Use NAPI-RS objects instead of JSON strings for keyboard events
6. **Movement commands** - TypeScript sends direction, Rust applies movement with wrapping
7. **Exit mechanism** - Ctrl+C signal handler (SIGINT)

### Cursor Movement Rules

**Arrow key mapping:**
- `ArrowUp`: `row = (row - 1 + max_rows) % max_rows` (wrap up)
- `ArrowDown`: `row = (row + 1) % max_rows` (wrap down)
- `ArrowLeft`: `col = (col - 1 + max_cols) % max_cols` (wrap left)
- `ArrowRight`: `col = (col + 1) % max_cols` (wrap right)

**Edge wrapping formula:** `(position + delta + max) % max` ensures wrap-around in both directions.

**Cursor rendering:** Block cursor (█) over the character at current position, similar to vim normal mode.

**Text boundaries:**
- Max rows = number of lines in demo text
- Max cols = length of longest line in demo text
- Cursor cannot move beyond these boundaries (wraps within text area)

### Demo Text

Hardcoded paragraph displayed in the center of the terminal:

```
Welcome to ReVim!

This is a demo text for the TUI.
Use arrow keys to move the cursor.
Press Ctrl+C to exit.

The cursor wraps around edges.
```

## Tasks

### Task 1 - Add Ratatui Dependencies

#### Acceptance Criteria

- `lib/Cargo.toml` includes `ratatui` dependency at version 0.30.0
- `lib/Cargo.toml` includes `crossterm` dependency at version 0.29.0
- `cargo build` compiles successfully with new dependencies
- No version conflicts with existing dependencies (napi, tokio)

#### Non-Automatable

- Manual verification: `cargo tree` shows correct dependency versions

### Task 2 - Implement TUI State in Rust

#### Acceptance Criteria

- `lib/src/tui.rs` module exists with TUI state struct
- State struct contains: terminal instance, cursor position (row, col), demo text
- `#[napi]` function `init_tui()` creates terminal and returns success
- `#[napi]` function `render_frame(cursor_row: u16, cursor_col: u16)` renders current frame
- `#[napi]` function `shutdown_tui()` cleans up terminal
- Terminal enters alternate screen mode and raw mode on init
- Terminal restores original mode on shutdown

#### Non-Automatable

- Manual verification: running app shows terminal in alternate screen mode

### Task 3 - Implement Keyboard Event Emitter

#### Acceptance Criteria

- `#[napi]` function `start_keyboard_listener(callback: ThreadsafeFunction<KeyboardEvent>)` exists
- `KeyboardEvent` struct with fields: `key: String`, `modifiers: Vec<String>`
- Spawns background thread that captures keyboard events via crossterm
- Each key event is sent as typed object: `KeyboardEvent { key: "ArrowUp", modifiers: [] }`
- Supports arrow keys: ArrowUp, ArrowDown, ArrowLeft, ArrowRight
- Supports Ctrl+C: `KeyboardEvent { key: "c", modifiers: ["Ctrl"] }`
- Callback receives typed object (no JSON parsing needed in TypeScript)
- Event listener runs in separate thread to avoid blocking render

#### Non-Automatable

- Manual verification: pressing keys shows events in TypeScript console

### Task 4 - Implement Cursor Movement Commands

#### Acceptance Criteria

- `#[napi]` function `move_cursor(direction: String)` exists
- Direction parameter accepts: "up", "down", "left", "right"
- Rust maintains internal cursor position state (row, col)
- Applies movement with wrapping logic: `(pos + delta + max) % max`
- Returns new cursor position: `CursorPosition { row: u16, col: u16 }`
- Movement respects demo text boundaries (max rows = text line count, max cols = longest line)
- Re-renders frame after each movement

#### Non-Automatable

- Manual verification: cursor wraps correctly at edges

### Task 5 - Update TypeScript App

#### Acceptance Criteria

- `app/src/index.ts` initializes TUI on startup
- Subscribes to keyboard events via `start_keyboard_listener`
- On each keyboard event:
  - If Ctrl+C: calls `shutdown_tui()` and exits
  - If arrow key: calls `move_cursor(direction)` where direction is "up"/"down"/"left"/"right"
- App exits cleanly on Ctrl+C
- Demo text is hardcoded in Rust, not passed from TypeScript

#### Non-Automatable

- Manual verification: running `just dev` shows TUI immediately
- Manual verification: arrow keys move cursor with wrapping
- Manual verification: Ctrl+C exits cleanly

### Task 6 - Update Justfile

#### Acceptance Criteria

- `just dev` command runs the TUI application
- `just build` compiles Rust library with ratatui
- `just test` placeholder remains (no tests for TUI yet)
- `just lint` runs cargo clippy and any TypeScript linters

#### Non-Automatable

- Manual verification: `just --list` shows all commands

## Bootstrap

```bash
# Install just (if not installed)
# macOS: brew install just
# Linux: cargo install just

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

- **ratatui**: 0.30.0 - Terminal UI library with crossterm backend
- **crossterm**: 0.29.0 - Cross-platform terminal manipulation (ratatui dependency)
- **napi crate**: 3.8.3 - Rust N-API bindings (existing)
- **napi-derive crate**: 3.5.2 - Procedural macros for #[napi] (existing)
- **tokio**: 1.x - Async runtime (existing)
- **Bun**: 1.3.9 - TypeScript runtime (existing)

Ratatui 0.30.0 is the latest stable with no breaking changes. Crossterm 0.29.0 is compatible with ratatui 0.30.0.

## Notes

- Ratatui requires alternate screen mode to avoid corrupting terminal history
- Raw mode is needed to capture individual key events without line buffering
- ThreadsafeFunction allows keyboard events from background thread to TypeScript
- Ctrl+C handling requires signal handler or checking for Ctrl+C in event loop
- Cursor wrapping formula `(pos + delta + max) % max` works for both positive and negative deltas
- Demo text boundaries: max_rows = number of lines, max_cols = length of longest line
- Typed objects (NAPI-RS structs) eliminate JSON parsing overhead
- Movement commands let Rust handle boundaries while TypeScript handles logic

## Data model

Not applicable - no persistent data.

## Contracts

### Rust Library API

```rust
// Initialize TUI
#[napi]
fn init_tui() -> Result<()>

// Shutdown TUI and restore terminal
#[napi]
fn shutdown_tui() -> Result<()>

// Start keyboard event listener
#[napi]
fn start_keyboard_listener(callback: ThreadsafeFunction<KeyboardEvent>)

// Move cursor in direction (returns new position)
#[napi]
fn move_cursor(direction: String) -> Result<CursorPosition>

// Event types
struct KeyboardEvent {
    key: String,
    modifiers: Vec<String>,
}

struct CursorPosition {
    row: u16,
    col: u16,
}
```

### TypeScript Interface (generated)

```typescript
export function initTui(): void
export function shutdownTui(): void
export function startKeyboardListener(callback: (err: Error | null, value: KeyboardEvent) => void): void
export function moveCursor(direction: string): { row: number; col: number }

interface KeyboardEvent {
    key: string;
    modifiers: string[];
}
```

### Keyboard Event Values

```typescript
// Arrow key events
{ key: "ArrowUp", modifiers: [] }
{ key: "ArrowDown", modifiers: [] }
{ key: "ArrowLeft", modifiers: [] }
{ key: "ArrowRight", modifiers: [] }

// Exit event (Ctrl+C)
{ key: "c", modifiers: ["Ctrl"] }
```