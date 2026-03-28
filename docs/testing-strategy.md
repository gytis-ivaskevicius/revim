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

test.use({ program: { file: "bun", args: ["run", "app/src/index.ts"] } });

test("example", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome")).toBeVisible();
  terminal.keyDown();
  const cursor = terminal.getCursor();
  expect(cursor.y).toBe(1);
});
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