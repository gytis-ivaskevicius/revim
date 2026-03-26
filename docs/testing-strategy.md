---
description: Read when writing or modifying tests. Defines framework, file conventions, and test priorities.
---

# Testing Strategy

## Principle

**E2E-first**: Cover as much functionality as possible through E2E tests. Only write unit/integration tests when E2E is impractical (e.g., performance, complex setup).

## Framework & Tooling

- **E2E**: `bun test` + `node-pty` + `ansi-escapes` + `ansi-styles`
- **Rust**: `cargo test`

## Running Tests

- `just test` — run all tests
- `just test-e2e` — E2E tests only
- `just test-rust` — Rust tests only
- `just check` — tests + linters

## File Conventions

- E2E: `app/tests/e2e/*.test.ts`
- Helpers: `app/tests/e2e/test-helpers.ts`
- Snapshots: `__snapshots__/*.snap`
- Rust: `#[cfg(test)]` in same file

## E2E Architecture

1. **node-pty** spawns app in pseudo-terminal
2. **ansi-escapes** sends keypresses
3. **ansi-styles** detects cursor position (reversed colors)
4. **Bun snapshots** compare output

```typescript
import { arrowUp, ctrlC } from 'ansi-escapes';
pty.write(arrowUp);
```

## Updates

- Update snapshots: `bun test --update`
- Project minimum coverage: 90%