---
description: Read when writing or modifying tests. Defines framework, file conventions, and test priorities.
---

# Testing Strategy

## Principle

**E2E-first**: Cover as much functionality as possible through E2E tests. Only write unit/integration tests when E2E is impractical (e.g., performance, complex setup).

## Framework & Tooling

- **E2E**: `@microsoft/tui-test` — Microsoft's terminal testing framework
- **Rust**: `cargo test`

## Running Tests

- `just test` — run all tests
- `just test-e2e` — E2E tests only (via `bunx @microsoft/tui-test`)
- `just test-rust` — Rust tests only
- `just check` — tests + linters

## File Conventions

- E2E: `app/tests/e2e/*.test.ts`
- Config: `tui-test.config.ts` (project root)
- Snapshots: `__snapshots__/*.snap` (relative to test file)
- Rust: `#[cfg(test)]` in same file

## E2E Architecture

1. **@microsoft/tui-test** spawns app in pseudo-terminal
2. **xterm.js** renders terminal output accurately
3. **Built-in assertions** for visibility, colors, snapshots
4. **Cursor position** via `terminal.getCursor()` (includes border offset)

```typescript
import { test, expect } from "@microsoft/tui-test";
import { keys } from "./test-utils.js";

test.use({ program: { file: "bun", args: ["run", "app/src/index.ts"] } });

test("example", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible();
  terminal.keyDown();
  const cursor = terminal.getCursor();
  expect(cursor.y).toBe(1);
});
```

## Test Utilities (`test-utils.ts`)

All E2E tests should use the centralized helpers from `app/tests/e2e/test-utils.js`:

```typescript
import { keys, test, expect } from "./test-utils.js";
```

### `keys.pressKeys(terminal, keySeq, options?)`

Send a sequence of keys with automatic delays between them. Handles both string keys and key objects with modifiers:

```typescript
// String keys
await keys.pressKeys(terminal, ["i", "h", "e", "l", "l", "o", "<Esc>"]);

// Key objects with modifiers
await keys.pressKeys(terminal, ["v", { key: "l", shift: true }]);

// Mixed
await keys.pressKeys(terminal, ["<Esc>", { key: "v", ctrl: true }, "j"]);
```

Supported string aliases:
- `"<Esc>"` → `terminal.keyEscape()`
- `"<BS>"` → `terminal.keyBackspace()`
- `"<Del>"` → `terminal.keyDelete()`
- `"<Left>"`, `"<Right>"`, `"<Up>"`, `"<Down>"` → directional methods
- `"<Enter>"`, `"<Space>"` → keyPress

### `keys.delay(ms?)`

Returns a promise that resolves after the standard delay (~50ms). Use for rendering pauses:

```typescript
await keys.delay();
// or with custom ms:
await keys.delay(100);
```

### `keys.visibleBuffer(terminal)`

Returns the viewable buffer as a joined string for text assertions:

```typescript
const buffer = keys.visibleBuffer(terminal);
expect(buffer).toContain("Welcome to ReVim!");
```

### Key format for modifiers

Use key objects for Ctrl/Shift/Alt combinations:

```typescript
{ key: "v", ctrl: true }   // Ctrl+v
{ key: "V", shift: true }  // Shift+V
{ key: "c", alt: true }     // Alt+c
```

## Parametrized Tests

Use parametrized tests to avoid repetition when testing similar behaviors:

```typescript
const movements = [
  { name: "ArrowDown", key: () => terminal.keyDown(), axis: "y", delta: 1 },
  { name: "ArrowUp", key: () => terminal.keyUp(), axis: "y", delta: -1 },
];

for (const { name, key, axis, delta } of movements) {
  test(`${name} moves cursor`, async ({ terminal }) => {
    const before = terminal.getCursor();
    key();
    const after = terminal.getCursor();
    expect(after[axis]).toBe(before[axis] + delta);
  });
}
```

## Snapshot Testing

Use snapshots for visual regression. Include colors to capture cursor style:

```typescript
await expect(terminal).toMatchSnapshot({ includeColors: true });
```

Use `getCursor()` for precise position assertions when testing cursor movement.

## Updates

- Update snapshots: `bunx @microsoft/tui-test --update`
- Enable tracing: `bunx @microsoft/tui-test --trace`
- Project minimum coverage: 90%