---
description: Read when writing or modifying tests. Defines framework, file conventions, coverage targets, and test priorities.
---

# Testing Strategy

## Framework & Tooling

- **Rust**: `cargo test` (invoked via `just test`)
- **TypeScript/Bun**: `bun test` (invoked via `just test`)
- **NAPI bindings**: Manual verification for POC, automated integration tests for production

## Running Tests

Use the Justfile as the entrypoint:
- `just test` — run all tests
- `just lint` — run all linters
- `just check` — run tests and linters together

## File Conventions

- Rust tests: `#[cfg(test)]` modules in same file as code, or `tests/` directory for integration tests
- TypeScript tests: `*.test.ts` files colocated with source

## Test Priority

1. Unit tests (preferred)
2. Integration tests
3. E2E

## Coverage

- Core logic: 100%
- UI: 80%
- Project minimum: 90%

## NAPI-RS Testing Notes

- ThreadsafeFunction behavior requires integration tests (can't unit test cross-thread callbacks easily)
- Use `bun test` for TypeScript-side validation
- Use `cargo test` for Rust-side logic

## TUI Testing Notes

- TUI components require manual verification during development
- Integration tests for TUI: use expect-style testing (e.g., `expect-test` crate) for frame rendering
- E2E tests: use terminal automation tools (e.g., `pty-test` or similar) for keyboard input simulation
- Manual testing checklist: cursor movement, edge wrapping, exit handling