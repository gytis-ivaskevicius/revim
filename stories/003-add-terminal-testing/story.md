# Add Terminal Testing Framework

## Context

We are building a vim editor with a Rust TUI (ratatui) controlled by TypeScript. The current implementation has no automated tests. Manual testing is slow, error-prone, and makes refactoring risky.

This feature adds a testing framework that can:
1. Spawn the app in a pseudo-terminal (PTY)
2. Send keypresses programmatically
3. Capture rendered output as snapshots
4. Compare against expected snapshots

This validates the full stack: TypeScript event handling → NAPI-RS bridge → Rust rendering.

## Out of Scope

- TypeScript unit tests (future story when more logic moves to TS)
- Performance benchmarks
- CI/CD integration (separate story)
- Windows/macOS testing (Linux-only initially)

## Implementation approach

### Architecture

E2E Tests using PTY-based approach:
- Use `node-pty` to spawn the app in a pseudo-terminal
- Use `ansi-styles` to parse ANSI escape codes (detect cursor position via reversed colors)
- Use `ansi-escapes` to generate keypress sequences
- Capture raw PTY output as snapshots
- Use Bun's built-in snapshot testing (`expect(snapshot).toMatchSnapshot()`)

### Key Technical Decisions

1. **node-pty 1.1.0** — Spawn app in pseudo-terminal for E2E tests.
2. **ansi-escapes 7.3.0** — Generate keyboard input sequences.
3. **ansi-styles 6.2.3** — Parse ANSI codes to detect cursor (reversed colors).

### E2E Test Flow

```
1. Create PTY with node-pty (80x30 terminal)
2. Spawn app: bun run src/index.ts
3. Wait for initial render (poll for expected content)
4. Capture raw PTY output as string
5. Use ansi-styles to detect cursor position (reversed colors)
6. Assert snapshot matches (includes cursor position via ANSI codes)
7. Write keypresses to PTY: pty.write(arrowUp) using ansi-escapes
8. Capture new output, compare snapshot
```

### Key Encoding

Use `ansi-escapes` library to generate key sequences:
```typescript
import { arrowUp, arrowDown, arrowLeft, arrowRight } from 'ansi-escapes';
pty.write(arrowUp);
pty.write(arrowDown);
```

### Snapshot Format

E2E snapshots store the raw PTY output including ANSI escape sequences. The cursor appears as reversed text (the character under cursor has inverted colors).

```
ESC[7mWESC[0melcome to ReVim!
ESC[0m
ESC[0mThis is a demo text for the TUI.
...
```

For easier debugging, use `strip-ansi` to see plain text version, but actual snapshots retain full ANSI for cursor verification.

### Test Coverage Goals

E2E tests must cover:
1. Initial render — screen shows demo text with cursor at (0,0)
2. Cursor movement — all four directions
3. Edge wrapping — cursor wraps at boundaries
4. Exit handling — Ctrl+C exits cleanly

## Tasks

### Task 1 - Add E2E Test Infrastructure

#### Acceptance Criteria

- `app/package.json` includes `node-pty` dependency at version 1.1.0
- `app/package.json` includes `ansi-styles` dependency at version 6.2.3 (for cursor detection)
- `app/package.json` includes `ansi-escapes` dependency at version 7.3.0 (for key generation)
- `bun install` succeeds with new dependencies
- `app/tests/e2e/` directory exists
- `app/tests/e2e/test-helpers.ts` exports `spawnApp()` function that returns PTY instance
- `app/tests/e2e/test-helpers.ts` exports `captureScreen()` function that returns raw PTY output string
- `app/tests/e2e/test-helpers.ts` exports `getCursorPosition(screenOutput)` function that parses ANSI to find cursor (row, col)
- `app/tests/e2e/test-helpers.ts` exports `waitForRender(expectedContent, timeout)` function

#### Non-Automatable

- Manual verification: test helpers compile without errors

### Task 2 - Add Initial Render E2E Test

#### Acceptance Criteria

- `app/tests/e2e/initial-render.test.ts` exists
- Test spawns app in PTY with 80x30 terminal size
- Test captures initial screen content
- Snapshot matches expected output showing demo text
- Snapshot shows cursor at position (0,0) — first character of first line reversed
- Test cleans up PTY after completion
- `bun test app/tests/e2e/initial-render.test.ts` passes

#### Non-Automatable

- None

### Task 3 - Add Cursor Movement E2E Tests

#### Acceptance Criteria

- `app/tests/e2e/cursor-movement.test.ts` exists
- Test case: ArrowDown moves cursor down one row
  - → cursor row increments by 1
  - → snapshot shows cursor on second line
- Test case: ArrowUp from row 0 wraps to last row
  - → cursor row becomes max_rows - 1
  - → snapshot shows cursor on last line
- Test case: ArrowRight moves cursor right one column
  - → cursor col increments by 1
  - → snapshot shows cursor moved right
- Test case: ArrowLeft from col 0 wraps to end of line
  - → cursor col becomes line_length - 1
  - → snapshot shows cursor at end of line
- Test case: ArrowDown at last row wraps to row 0
  - → cursor row becomes 0
  - → snapshot shows cursor on first line
- All tests use snapshot comparisons
- `bun test app/tests/e2e/cursor-movement.test.ts` passes

#### Non-Automatable

- None

### Task 4 - Add Exit Handling E2E Test

#### Acceptance Criteria

- `app/tests/e2e/exit.test.ts` exists
- Test sends Ctrl+C (`\x03`) to PTY
- Test verifies app exits cleanly (PTY closes)
- Test verifies no error output on exit
- `bun test app/tests/e2e/exit.test.ts` passes

#### Non-Automatable

- None

### Task 5 - Update Justfile for Testing

#### Acceptance Criteria

- `just test` runs both Rust tests and E2E tests
- `just test-rust` runs only Rust unit tests
- `just test-e2e` runs only E2E tests
- `just lint` unchanged (cargo clippy)
- `just check` runs tests and linters

#### Non-Automatable

- Manual verification: `just --list` shows all commands

## Bootstrap

```bash
# Install just (if not installed)
# macOS: brew install just
# Linux: cargo install just

# Install Rust dependencies
cd lib && cargo build

# Install TypeScript dependencies (including test deps)
cd ../app && bun install

# Build Rust library
just build

# Run all tests
just test

# Run all checks
just check
```

Note: node-pty requires native build tools (build-essential, python3). Ensure these are installed before `bun install`.

## Technical Context

- **node-pty**: 1.1.0 — Cross-platform PTY for spawning terminal processes. Required for E2E tests.
- **ansi-escapes**: 7.3.0 — Generate ANSI escape sequences for keyboard input.
- **ansi-styles**: 6.2.3 — Parse ANSI escape codes to detect cursor position (reversed text).
- **Bun**: 1.3.9 — TypeScript runtime with built-in test runner and snapshot support.
- **ratatui**: 0.30.0 — Terminal UI library (existing).
- **crossterm**: 0.29.0 — Terminal manipulation (existing).

node-pty 1.1.0, ansi-escapes 7.3.0, and ansi-styles 6.2.3 are the latest stable versions.

## Notes

- E2E tests require a PTY which may not work in all CI environments. Consider Docker-based CI for isolation.
- Snapshot files should be committed to git for reproducibility.
- Use `bun test --update` to update snapshots when UI changes intentionally.
- PTY output includes ANSI escape sequences. Cursor position is indicated by reversed colors (ANSI reverse video code).
- Cursor detection: look for `\x1b[7m` (reverse on) and `\x1b[0m` (reset) around the cursor character.

## Data model

Not applicable — no persistent data.

## Contracts

### E2E Test Helper API

```typescript
// app/tests/e2e/test-helpers.ts
import { arrowUp, arrowDown, arrowLeft, arrowRight, ctrlC } from 'ansi-escapes';

interface SpawnOptions {
  rows?: number;    // default: 30
  cols?: number;    // default: 80
  env?: Record<string, string>;
}

interface AppHandle {
  pty: IPty;
  cleanup(): void;
  sendKey(key: string): void;
  captureScreen(): string;
  waitForRender(expected: string | RegExp, timeout?: number): Promise<void>;
}

interface CursorPosition {
  row: number;
  col: number;
}

function spawnApp(options?: SpawnOptions): Promise<AppHandle>;
function captureScreen(): string;
function getCursorPosition(screenOutput: string): CursorPosition;
function waitForRender(expected: string | RegExp, timeout?: number): Promise<void>;
```