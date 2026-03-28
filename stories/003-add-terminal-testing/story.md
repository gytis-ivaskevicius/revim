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

## Implementation approach

### Architecture

E2E Tests using Microsoft's TUI Test framework:
- Use `@microsoft/tui-test` to spawn the app in a pseudo-terminal
- Built-in key handling methods (keyUp, keyDown, keyLeft, keyRight, keyCtrlC, etc.)
- Built-in terminal rendering with xterm.js for accurate output capture
- Built-in snapshot testing with `expect(terminal).toMatchSnapshot()`
- Rich assertions: `toBeVisible()`, `toHaveBgColor()`, `toHaveFgColor()`
- Multi-platform support (macOS, Linux, Windows)

### Key Technical Decisions

1. **@microsoft/tui-test 0.0.3** — Microsoft's terminal testing framework. Provides PTY spawning, key handling, and snapshot testing out of the box. Uses xterm.js for accurate terminal rendering.

### App Rendering Details

The app renders inside a bordered block with title "ReVim":
```
╭────────────────────────────────────────────────────────────────────────────────╮
│ReVim                                                                           │
│Welcome to ReVim!                                                               │
│This is a demo text for the TUI.                                                │
│...                                                                             │
╰────────────────────────────────────────────────────────────────────────────────╯
```

The cursor is rendered using reversed style (ANSI reverse video) on the character under the cursor. Terminal cursor position from `getCursor()` reflects the actual terminal position, which includes the border offset.

### Snapshot vs Cursor Assertions

Use snapshots for visual regression (full screen content):
```typescript
await expect(terminal).toMatchSnapshot({ includeColors: true });
```

Use `getCursor()` for precise cursor position assertions:
```typescript
const cursor = terminal.getCursor();
expect(cursor.x).toBe(1);  // Column (accounting for border)
expect(cursor.y).toBe(2);  // Row (accounting for border)
```

### E2E Test Flow

```typescript
import { test, expect } from "@microsoft/tui-test";

test.use({ 
  program: { file: "bun", args: ["run", "app/src/index.ts"] },
  rows: 30,
  columns: 80 
});

test("initial render shows demo text", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible();
  await expect(terminal).toMatchSnapshot({ includeColors: true });
});
```

### Key Handling

Use built-in terminal methods for key presses:
```typescript
terminal.keyUp();       // Arrow up
terminal.keyDown();     // Arrow down
terminal.keyLeft();     // Arrow left
terminal.keyRight();    // Arrow right
terminal.keyCtrlC();    // Ctrl+C
terminal.keyPress('a'); // Character key
```

### Test Coverage Goals

E2E tests must cover:
1. Initial render — screen shows demo text with cursor visible
2. Cursor movement — all four directions
3. Edge wrapping — cursor wraps at boundaries
4. Exit handling — Ctrl+C exits cleanly

## Tasks

### Task 1 - Add E2E Test Infrastructure

#### Acceptance Criteria

- `app/package.json` includes `@microsoft/tui-test` dependency at version 0.0.3 (devDependency)
- `bun install` succeeds with new dependency
- `tui-test.config.ts` exists in project root with configuration:
  - `testMatch: "app/tests/**/*.test.ts"` to find tests in app/tests/
  - `retries: 2` for flakiness tolerance
- `app/tests/e2e/` directory exists
- `just build` has been run (Rust library must be compiled before tests can run)

#### Non-Automatable

- Manual verification: `bunx @microsoft/tui-test` runs without errors from project root

### Task 2 - Add Initial Render E2E Test

#### Acceptance Criteria

- `app/tests/e2e/initial-render.test.ts` exists
- Test file imports: `import { test, expect } from "@microsoft/tui-test"`
- Test uses `test.use({ program: { file: "bun", args: ["run", "app/src/index.ts"] } })` to configure app path (run from project root)
- Test uses `test.use({ rows: 30, columns: 80 })` for terminal size
- Test uses `await expect(terminal.getByText("Welcome to ReVim!")).toBeVisible()` to verify content
- Test uses `await expect(terminal).toMatchSnapshot({ includeColors: true })` for visual regression (includes cursor style)
- `bunx @microsoft/tui-test` passes

#### Non-Automatable

- None

### Task 3 - Add Cursor Movement E2E Tests

Use parametrized tests to avoid repetition. Test cursor movement in all four directions with wrapping behavior.

#### Acceptance Criteria

- `app/tests/e2e/cursor-movement.test.ts` exists
- Uses parametrized test pattern with array of test cases:
  ```typescript
  const movements = [
    { name: "ArrowDown", key: "down", axis: "y", direction: 1 },
    { name: "ArrowUp", key: "up", axis: "y", direction: -1 },
    { name: "ArrowRight", key: "right", axis: "x", direction: 1 },
    { name: "ArrowLeft", key: "left", axis: "x", direction: -1 },
  ];
  
  for (const { name, key, axis, direction } of movements) {
    test(`${name} moves cursor`, async ({ terminal }) => { ... });
  }
  ```
- Test case: ArrowDown moves cursor down one row (y increments)
- Test case: ArrowUp from row 0 wraps to last row
- Test case: ArrowRight moves cursor right one column (x increments)
- Test case: ArrowLeft from col 0 wraps to end of line
- Test case: ArrowDown at last row wraps to row 0
- All tests use `terminal.getCursor()` for assertions
- Tests account for border offset (cursor position includes border)
- `bunx @microsoft/tui-test` passes

#### Non-Automatable

- None

### Task 4 - Add Exit Handling E2E Test

#### Acceptance Criteria

- `app/tests/e2e/exit.test.ts` exists
- Test sends Ctrl+C via `terminal.keyCtrlC()`
- Test uses `await new Promise<void>(resolve => terminal.onExit(() => resolve()))` to wait for exit
- Test verifies exit using `terminal.exitResult?.exitCode === 0`
- `bunx @microsoft/tui-test` passes

#### Non-Automatable

- None

### Task 5 - Update Justfile for Testing

#### Acceptance Criteria

- `just test` runs both Rust tests and E2E tests (in sequence)
- `just test-rust` runs only Rust unit tests (existing: `cd lib && cargo test`)
- `just test-e2e` runs only E2E tests: `bunx @microsoft/tui-test`
- `just lint` unchanged (cargo clippy)
- `just check` runs tests and linters

#### Non-Automatable

- Manual verification: `just --list` shows all commands

## Bootstrap

```bash
# Install just (if not installed)
# macOS: brew install just
# Linux: cargo install just

# Build Rust library (REQUIRED before running tests)
just build

# Install TypeScript dependencies (including test deps)
cd app && bun install

# Run all tests
just test

# Run all checks
just check
```

Note: @microsoft/tui-test uses native PTY bindings. Ensure build tools are installed (build-essential on Linux, Xcode on macOS).

## Technical Context

- **@microsoft/tui-test**: 0.0.3 — Microsoft's terminal testing framework. Provides PTY spawning, key handling, snapshot testing, and rich assertions. Uses xterm.js for accurate terminal rendering.
- **Bun**: 1.3.9 — TypeScript runtime. TUI Test supports Bun 1.3.5+.
- **ratatui**: 0.30.0 — Terminal UI library (existing).
- **crossterm**: 0.29.0 — Terminal manipulation (existing).

@microsoft/tui-test 0.0.3 is the latest stable version.

## Notes

- TUI Test creates a new terminal context for each test, providing full isolation.
- TUI Test uses xterm.js (same engine as VS Code's terminal) for accurate rendering.
- Config file: `tui-test.config.ts` in project root (not in app/).
- Tests run from project root, so app path is `app/src/index.ts`.
- Snapshot files are stored in `__snapshots__/` directory (relative to test file) and should be committed to git.
- Use `bunx @microsoft/tui-test --update` to update snapshots when UI changes intentionally.
- TUI Test supports tracing via `--trace` flag for debugging test failures.
- Multi-platform: works on macOS, Linux, and Windows with various shells.

## Data model

Not applicable — no persistent data.

## Contracts

### TUI Test API

```typescript
import { test, expect } from "@microsoft/tui-test";

// Configure test with program to run (from project root)
test.use({ 
  program: { file: "bun", args: ["run", "app/src/index.ts"] },
  rows: 30,
  columns: 80 
});

test("example test", async ({ terminal }) => {
  // Key input
  terminal.keyUp();
  terminal.keyDown();
  terminal.keyLeft();
  terminal.keyRight();
  terminal.keyCtrlC();
  terminal.keyPress('a');
  
  // Cursor position (actual terminal position, includes border offset)
  const cursor = terminal.getCursor();
  // cursor.x — column (0-based)
  // cursor.y — row (0-based)
  // cursor.baseY — scroll position
  
  // Text assertions
  await expect(terminal.getByText("text")).toBeVisible();
  await expect(terminal.getByText(/regex/)).toBeVisible();
  
  // Color assertions
  await expect(terminal.getByText("text")).toHaveFgColor("#FFFFFF");
  await expect(terminal.getByText("text")).toHaveBgColor("#000000");
  
  // Snapshot (includeColors: true captures cursor style)
  await expect(terminal).toMatchSnapshot();
  await expect(terminal).toMatchSnapshot({ includeColors: true });
  
  // Exit handling
  const exitPromise = new Promise<void>(resolve => {
    terminal.onExit(() => resolve());
  });
  terminal.keyCtrlC();
  await exitPromise;
  expect(terminal.exitResult?.exitCode).toBe(0);
});
```

### Configuration File

```typescript
// tui-test.config.ts (in project root)
import { defineConfig } from "@microsoft/tui-test";

export default defineConfig({
  testMatch: "app/tests/**/*.test.ts",
  retries: 2,
  trace: true
});
```

### Parametrized Test Pattern

```typescript
import { test, expect } from "@microsoft/tui-test";

test.use({ 
  program: { file: "bun", args: ["run", "app/src/index.ts"] },
  rows: 30,
  columns: 80 
});

const movements = [
  { name: "ArrowDown moves down", key: () => terminal.keyDown(), axis: "y", delta: 1 },
  { name: "ArrowUp moves up", key: () => terminal.keyUp(), axis: "y", delta: -1 },
  { name: "ArrowRight moves right", key: () => terminal.keyRight(), axis: "x", delta: 1 },
  { name: "ArrowLeft moves left", key: () => terminal.keyLeft(), axis: "x", delta: -1 },
];

for (const { name, key, axis, delta } of movements) {
  test(name, async ({ terminal }) => {
    await expect(terminal.getByText("Welcome")).toBeVisible();
    const before = terminal.getCursor();
    key();
    const after = terminal.getCursor();
    expect(after[axis]).toBe(before[axis] + delta);
  });
}
```